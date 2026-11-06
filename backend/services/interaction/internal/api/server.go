package api

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"sozhiteli.internal/interaction/internal/contactrules"
	"sozhiteli.internal/interaction/internal/store"
	"sozhiteli.internal/platform/auth"
	"sozhiteli.internal/platform/problem"
)

// Server implements the public Interaction API (StrictServerInterface,
// generated from contracts/openapi/interaction.v1.yaml).
//
// The contact reveal rule (ADR-0005 in README.md) is enforced here and only here:
// another person's contact is returned only inside a contact request with
// status accepted, and only to its two participants. Contact values are never
// logged.
type Server struct {
	pool       *pgxpool.Pool
	queries    *store.Queries
	dailyLimit int
}

// NewServer returns the public API implementation. dailyLimit is the number
// of new contact requests one user may create per 24 hours.
func NewServer(pool *pgxpool.Pool, dailyLimit int) *Server {
	s := &Server{pool: pool, dailyLimit: dailyLimit}
	if pool != nil {
		s.queries = store.New(pool)
	}
	return s
}

var _ StrictServerInterface = (*Server)(nil)

const (
	defaultPageSize = 20
	// rateLimitRetry is the Retry-After of a sender who reached the daily
	// limit; the window slides, so an hour is a reasonable hint.
	rateLimitRetry = time.Hour
)

var (
	errContactRequired = problem.Conflict("contact_required", "set your own contact first: the exchange is always mutual")
	errRequestNotFound = problem.NotFound("contact_request_not_found", "no such contact request")
)

// GetMyContact returns the caller's own contact.
func (s *Server) GetMyContact(ctx context.Context, _ GetMyContactRequestObject) (GetMyContactResponseObject, error) {
	userID, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := s.queries.GetContact(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, problem.NotFound("contact_not_found", "contact has not been set yet")
	}
	if err != nil {
		return nil, fmt.Errorf("load contact: %w", err)
	}
	return GetMyContact200JSONResponse{Kind: ContactKind(row.Kind), Value: row.Value}, nil
}

// PutMyContact sets or replaces the caller's own contact.
func (s *Server) PutMyContact(ctx context.Context, request PutMyContactRequestObject) (PutMyContactResponseObject, error) {
	userID, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if request.Body == nil {
		return nil, problem.InvalidRequest("request body is required")
	}
	body := *request.Body
	if !contactrules.Valid(string(body.Kind), body.Value) {
		return nil, problem.Validation(problem.FieldError{
			Field:   "value",
			Code:    contactrules.CodeInvalidFormat,
			Message: "value does not match the format of " + string(body.Kind),
		})
	}
	row, err := s.queries.UpsertContact(ctx, store.UpsertContactParams{
		UserID: userID,
		Kind:   string(body.Kind),
		Value:  body.Value,
	})
	if err != nil {
		return nil, fmt.Errorf("save contact: %w", err)
	}
	return PutMyContact200JSONResponse{Kind: ContactKind(row.Kind), Value: row.Value}, nil
}

// CreateContactRequest sends a contact exchange request.
func (s *Server) CreateContactRequest(ctx context.Context, request CreateContactRequestRequestObject) (CreateContactRequestResponseObject, error) {
	senderID, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if request.Body == nil {
		return nil, problem.InvalidRequest("request body is required")
	}
	recipientID := request.Body.RecipientId
	if recipientID == senderID {
		return nil, problem.Validation(problem.FieldError{
			Field: "recipient_id", Code: "self_request", Message: "a request cannot be sent to yourself",
		})
	}

	var created store.ContactRequest
	err = s.inTx(ctx, func(q *store.Queries) error {
		if err := q.LockPair(ctx, store.LockPairParams{UserA: senderID.String(), UserB: recipientID.String()}); err != nil {
			return fmt.Errorf("lock pair: %w", err)
		}
		hasContact, err := q.ContactExists(ctx, senderID)
		if err != nil {
			return fmt.Errorf("check contact: %w", err)
		}
		if !hasContact {
			return errContactRequired
		}
		blocked, err := q.BlockExistsBetween(ctx, store.BlockExistsBetweenParams{UserA: senderID, UserB: recipientID})
		if err != nil {
			return fmt.Errorf("check block: %w", err)
		}
		if blocked {
			return errBlocked
		}
		existing, err := q.ListRequestsBetween(ctx, store.ListRequestsBetweenParams{UserA: senderID, UserB: recipientID})
		if err != nil {
			return fmt.Errorf("find existing requests: %w", err)
		}
		// At most one request exists per pair; a declined one still counts, so
		// a refusal cannot be bypassed by asking again.
		for _, r := range existing {
			if r.SenderID == senderID {
				return problem.Conflict("request_exists", "a request to this user already exists")
			}
		}
		if len(existing) > 0 {
			return problem.Conflict("reverse_request_exists", "this user has already sent you a request: accept or decline it")
		}
		recent, err := q.CountRecentRequests(ctx, senderID)
		if err != nil {
			return fmt.Errorf("count recent requests: %w", err)
		}
		if recent >= int64(s.dailyLimit) {
			return problem.TooManyRequests(rateLimitRetry)
		}
		created, err = q.InsertRequest(ctx, store.InsertRequestParams{SenderID: senderID, RecipientID: recipientID})
		if isUniqueViolation(err) {
			return problem.Conflict("request_exists", "a request to this user already exists")
		}
		if err != nil {
			return fmt.Errorf("insert request: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return CreateContactRequest201JSONResponse(outgoingRequest(created)), nil
}

// ListContactRequests lists the caller's incoming or outgoing requests, newest
// first. The counterpart's contact is present only in accepted ones.
func (s *Server) ListContactRequests(ctx context.Context, request ListContactRequestsRequestObject) (ListContactRequestsResponseObject, error) {
	userID, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	params := request.Params
	after := listStart
	if params.Cursor != nil {
		if after, err = decodeListCursor(*params.Cursor); err != nil {
			return nil, problem.InvalidRequest("cursor is not valid")
		}
	}
	pageSize := int32(defaultPageSize)
	if params.Limit != nil {
		pageSize = *params.Limit
	}
	var counterpart pgtype.UUID
	if params.CounterpartId != nil {
		counterpart = pgtype.UUID{Bytes: *params.CounterpartId, Valid: true}
	}

	// One row more than the page tells whether another page exists.
	var rows []listedRequest
	switch params.Direction {
	case Incoming:
		found, err := s.queries.ListIncoming(ctx, store.ListIncomingParams{
			UserID: userID, CounterpartID: counterpart,
			AfterCreatedAt: after.CreatedAt, AfterID: after.ID, PageSize: pageSize + 1,
		})
		if err != nil {
			return nil, fmt.Errorf("list incoming requests: %w", err)
		}
		for _, r := range found {
			rows = append(rows, listedRequest(r))
		}
	default:
		found, err := s.queries.ListOutgoing(ctx, store.ListOutgoingParams{
			UserID: userID, CounterpartID: counterpart,
			AfterCreatedAt: after.CreatedAt, AfterID: after.ID, PageSize: pageSize + 1,
		})
		if err != nil {
			return nil, fmt.Errorf("list outgoing requests: %w", err)
		}
		for _, r := range found {
			rows = append(rows, listedRequest(r))
		}
	}

	var next *string
	if len(rows) > int(pageSize) {
		rows = rows[:pageSize]
		last := rows[len(rows)-1]
		cursor := encodeListCursor(listPosition{CreatedAt: last.CreatedAt, ID: last.ID})
		next = &cursor
	}
	items := make([]ContactRequest, 0, len(rows))
	for _, r := range rows {
		items = append(items, r.toAPI(params.Direction))
	}
	return ListContactRequests200JSONResponse{Items: items, NextCursor: next}, nil
}

// AcceptContactRequest accepts an incoming request: both participants see
// each other's contact from now on.
func (s *Server) AcceptContactRequest(ctx context.Context, request AcceptContactRequestRequestObject) (AcceptContactRequestResponseObject, error) {
	result, err := s.respond(ctx, request.RequestId, Accepted)
	if err != nil {
		return nil, err
	}
	return AcceptContactRequest200JSONResponse(result), nil
}

// DeclineContactRequest declines an incoming request; no contact is revealed.
func (s *Server) DeclineContactRequest(ctx context.Context, request DeclineContactRequestRequestObject) (DeclineContactRequestResponseObject, error) {
	result, err := s.respond(ctx, request.RequestId, Declined)
	if err != nil {
		return nil, err
	}
	return DeclineContactRequest200JSONResponse(result), nil
}

func (s *Server) respond(ctx context.Context, requestID uuid.UUID, status ContactRequestStatus) (ContactRequest, error) {
	recipientID, err := auth.UserID(ctx)
	if err != nil {
		return ContactRequest{}, err
	}

	var result ContactRequest
	err = s.inTx(ctx, func(q *store.Queries) error {
		if status == Accepted {
			hasContact, err := q.ContactExists(ctx, recipientID)
			if err != nil {
				return fmt.Errorf("check contact: %w", err)
			}
			if !hasContact {
				return errContactRequired
			}
		}

		updated, err := q.RespondToRequest(ctx, store.RespondToRequestParams{
			ID: requestID, RecipientID: recipientID, Status: string(status),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			// Either it is not the caller's incoming request, or it was answered
			// already. A sender and a stranger get the same 404.
			mine, err := q.RequestExistsForRecipient(ctx, store.RequestExistsForRecipientParams{
				ID: requestID, RecipientID: recipientID,
			})
			if err != nil {
				return fmt.Errorf("check request: %w", err)
			}
			if mine {
				return problem.Conflict("already_responded", "the request has already been answered")
			}
			return errRequestNotFound
		}
		if err != nil {
			return fmt.Errorf("respond to request: %w", err)
		}

		result = incomingRequest(updated)
		if status != Accepted {
			return nil
		}
		contact, err := q.GetContact(ctx, updated.SenderID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // cannot happen: sending requires a contact, and it cannot be deleted
		}
		if err != nil {
			return fmt.Errorf("load sender contact: %w", err)
		}
		result.CounterpartContact = &Contact{Kind: ContactKind(contact.Kind), Value: contact.Value}
		return nil
	})
	return result, err
}

// inTx runs fn in one transaction and commits when it returns nil.
func (s *Server) inTx(ctx context.Context, fn func(q *store.Queries) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)
	if err := fn(s.queries.WithTx(tx)); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

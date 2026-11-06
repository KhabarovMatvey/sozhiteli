package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"sozhiteli.internal/interaction/internal/store"
	"sozhiteli.internal/platform/auth"
	"sozhiteli.internal/platform/problem"
)

// Favorites (priority Should #15) and agreements of a pair (priority Should
// #16). A favorite is private to its owner. An agreement belongs to an
// accepted contact request and is shared by its two participants.

// maxFavorites keeps listFavorites a single small response.
const maxFavorites = 200

// ListFavorites returns the caller's saved candidates, newest first.
func (s *Server) ListFavorites(ctx context.Context, _ ListFavoritesRequestObject) (ListFavoritesResponseObject, error) {
	userID, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.queries.ListFavorites(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list favorites: %w", err)
	}
	items := make([]Favorite, 0, len(rows))
	for _, r := range rows {
		items = append(items, Favorite{UserId: r.UserID, CreatedAt: r.CreatedAt})
	}
	return ListFavorites200JSONResponse{Items: items}, nil
}

// AddFavorite saves a candidate; repeating it changes nothing.
func (s *Server) AddFavorite(ctx context.Context, request AddFavoriteRequestObject) (AddFavoriteResponseObject, error) {
	userID, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if request.UserId == userID {
		return nil, problem.Validation(problem.FieldError{
			Field: "user_id", Code: "self_favorite", Message: "you cannot save yourself",
		})
	}
	count, err := s.queries.CountFavorites(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("count favorites: %w", err)
	}
	if count >= maxFavorites {
		// Saving one already saved is still fine: the insert does nothing.
		rows, err := s.queries.ListFavorites(ctx, userID)
		if err != nil {
			return nil, fmt.Errorf("list favorites: %w", err)
		}
		saved := false
		for _, r := range rows {
			saved = saved || r.UserID == request.UserId
		}
		if !saved {
			return nil, problem.Conflict("favorite_limit", "too many saved candidates: remove someone first")
		}
	}
	if err := s.queries.UpsertFavorite(ctx, store.UpsertFavoriteParams{OwnerID: userID, UserID: request.UserId}); err != nil {
		return nil, fmt.Errorf("save favorite: %w", err)
	}
	return AddFavorite204Response{}, nil
}

// RemoveFavorite removes a saved candidate.
func (s *Server) RemoveFavorite(ctx context.Context, request RemoveFavoriteRequestObject) (RemoveFavoriteResponseObject, error) {
	userID, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.queries.DeleteFavorite(ctx, store.DeleteFavoriteParams{OwnerID: userID, UserID: request.UserId}); err != nil {
		return nil, fmt.Errorf("delete favorite: %w", err)
	}
	return RemoveFavorite204Response{}, nil
}

// agreementRequest loads the request the caller takes part in and checks that
// an agreement may exist for it: the request is accepted and nobody blocked
// the other.
func (s *Server) agreementRequest(ctx context.Context, q *store.Queries, userID, requestID uuid.UUID) (store.ContactRequest, error) {
	request, err := q.GetRequestForParticipant(ctx, store.GetRequestForParticipantParams{ID: requestID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return store.ContactRequest{}, errRequestNotFound
	}
	if err != nil {
		return store.ContactRequest{}, fmt.Errorf("load request: %w", err)
	}
	if request.Status != string(Accepted) {
		return store.ContactRequest{}, problem.Conflict("not_accepted", "agreements are available after the contact exchange")
	}
	blocked, err := q.BlockExistsBetween(ctx, store.BlockExistsBetweenParams{UserA: request.SenderID, UserB: request.RecipientID})
	if err != nil {
		return store.ContactRequest{}, fmt.Errorf("check block: %w", err)
	}
	if blocked {
		return store.ContactRequest{}, errBlocked
	}
	return request, nil
}

// GetAgreement returns what the pair has written down so far.
func (s *Server) GetAgreement(ctx context.Context, request GetAgreementRequestObject) (GetAgreementResponseObject, error) {
	userID, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.agreementRequest(ctx, s.queries, userID, request.RequestId); err != nil {
		return nil, err
	}
	row, err := s.queries.GetAgreement(ctx, request.RequestId)
	if errors.Is(err, pgx.ErrNoRows) {
		return GetAgreement200JSONResponse{RequestId: request.RequestId}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load agreement: %w", err)
	}
	result, err := agreementFromRow(row, userID)
	if err != nil {
		return nil, err
	}
	return GetAgreement200JSONResponse(result), nil
}

// PutAgreement replaces the pair's agreement; both participants see it.
func (s *Server) PutAgreement(ctx context.Context, request PutAgreementRequestObject) (PutAgreementResponseObject, error) {
	userID, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if request.Body == nil {
		return nil, problem.InvalidRequest("request body is required")
	}
	items := trimAgreement(request.Body.Items)
	raw, err := json.Marshal(items)
	if err != nil {
		return nil, fmt.Errorf("encode agreement: %w", err)
	}
	var result Agreement
	err = s.inTx(ctx, func(q *store.Queries) error {
		if _, err := s.agreementRequest(ctx, q, userID, request.RequestId); err != nil {
			return err
		}
		row, err := q.UpsertAgreement(ctx, store.UpsertAgreementParams{RequestID: request.RequestId, Items: raw, UpdatedBy: userID})
		if err != nil {
			return fmt.Errorf("save agreement: %w", err)
		}
		result, err = agreementFromRow(row, userID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return PutAgreement200JSONResponse(result), nil
}

// trimAgreement trims every topic and drops the empty ones.
func trimAgreement(in AgreementItems) AgreementItems {
	clean := func(v *string) *string {
		if v == nil {
			return nil
		}
		t := strings.TrimSpace(*v)
		if t == "" {
			return nil
		}
		return &t
	}
	return AgreementItems{
		Cleaning: clean(in.Cleaning), Guests: clean(in.Guests), Noise: clean(in.Noise),
		Payments: clean(in.Payments), MoveIn: clean(in.MoveIn), Other: clean(in.Other),
	}
}

func agreementFromRow(row store.Agreement, userID uuid.UUID) (Agreement, error) {
	var items AgreementItems
	if err := json.Unmarshal(row.Items, &items); err != nil {
		return Agreement{}, fmt.Errorf("decode agreement %s: %w", row.RequestID, err)
	}
	updatedAt := row.UpdatedAt
	byMe := row.UpdatedBy == userID
	return Agreement{RequestId: row.RequestID, Items: items, UpdatedAt: &updatedAt, UpdatedByMe: &byMe}, nil
}

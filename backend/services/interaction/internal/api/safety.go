package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"sozhiteli.internal/interaction/internal/store"
	"sozhiteli.internal/platform/auth"
	"sozhiteli.internal/platform/problem"
)

// Blocks and reports: protection from unwanted contact (README.md, section
// «Безопасность»). A block in either direction forbids new requests between
// two people, declines pending ones and hides contacts already revealed.
// Reports are reviewed by an administrator by hand.

const (
	// maxBlocks keeps listBlocks a single small response.
	maxBlocks = 500
	// reportDailyLimit stops one account from flooding the moderation queue.
	reportDailyLimit = 10
	maxReportComment = 500
)

var errBlocked = problem.Conflict("blocked", "requests between you and this user are not possible")

// ListBlocks returns everyone the caller has blocked, newest first.
func (s *Server) ListBlocks(ctx context.Context, _ ListBlocksRequestObject) (ListBlocksResponseObject, error) {
	userID, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.queries.ListBlocks(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list blocks: %w", err)
	}
	items := make([]Block, 0, len(rows))
	for _, r := range rows {
		items = append(items, Block{UserId: r.BlockedID, CreatedAt: r.CreatedAt})
	}
	return ListBlocks200JSONResponse{Items: items}, nil
}

// BlockUser blocks another user; repeating it changes nothing.
func (s *Server) BlockUser(ctx context.Context, request BlockUserRequestObject) (BlockUserResponseObject, error) {
	userID, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	target := request.UserId
	if target == userID {
		return nil, problem.Validation(problem.FieldError{
			Field: "user_id", Code: "self_block", Message: "you cannot block yourself",
		})
	}
	err = s.inTx(ctx, func(q *store.Queries) error {
		// The same lock as contact requests: a request created concurrently with
		// the block is either declined here or rejected by the block check.
		if err := q.LockPair(ctx, store.LockPairParams{UserA: userID.String(), UserB: target.String()}); err != nil {
			return fmt.Errorf("lock pair: %w", err)
		}
		count, err := q.CountBlocks(ctx, userID)
		if err != nil {
			return fmt.Errorf("count blocks: %w", err)
		}
		if count >= maxBlocks {
			already, err := q.BlockExistsBetween(ctx, store.BlockExistsBetweenParams{UserA: userID, UserB: target})
			if err != nil {
				return fmt.Errorf("check block: %w", err)
			}
			if !already {
				return problem.Conflict("block_limit", "too many blocked users: unblock someone first")
			}
		}
		if err := q.UpsertBlock(ctx, store.UpsertBlockParams{BlockerID: userID, BlockedID: target}); err != nil {
			return fmt.Errorf("save block: %w", err)
		}
		if err := q.DeclinePendingBetween(ctx, store.DeclinePendingBetweenParams{UserA: userID, UserB: target}); err != nil {
			return fmt.Errorf("decline pending requests: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return BlockUser204Response{}, nil
}

// UnblockUser removes the caller's block; requests declined by it stay declined.
func (s *Server) UnblockUser(ctx context.Context, request UnblockUserRequestObject) (UnblockUserResponseObject, error) {
	userID, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.queries.DeleteBlock(ctx, store.DeleteBlockParams{BlockerID: userID, BlockedID: request.UserId}); err != nil {
		return nil, fmt.Errorf("delete block: %w", err)
	}
	return UnblockUser204Response{}, nil
}

// CreateReport files a report about another user for manual review.
func (s *Server) CreateReport(ctx context.Context, request CreateReportRequestObject) (CreateReportResponseObject, error) {
	reporterID, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if request.Body == nil {
		return nil, problem.InvalidRequest("request body is required")
	}
	body := *request.Body
	if body.ReportedId == reporterID {
		return nil, problem.Validation(problem.FieldError{
			Field: "reported_id", Code: "self_report", Message: "you cannot report yourself",
		})
	}
	comment := ""
	if body.Comment != nil {
		comment = strings.TrimSpace(*body.Comment)
	}
	if len([]rune(comment)) > maxReportComment {
		return nil, problem.Validation(problem.FieldError{
			Field: "comment", Code: "too_long", Message: "comment is longer than 500 characters",
		})
	}
	if body.Reason == Other && comment == "" {
		return nil, problem.Validation(problem.FieldError{
			Field: "comment", Code: "comment_required", Message: "explain the reason in the comment",
		})
	}

	var created store.Report
	err = s.inTx(ctx, func(q *store.Queries) error {
		if err := q.LockPair(ctx, store.LockPairParams{UserA: reporterID.String(), UserB: body.ReportedId.String()}); err != nil {
			return fmt.Errorf("lock pair: %w", err)
		}
		recent, err := q.CountRecentReports(ctx, reporterID)
		if err != nil {
			return fmt.Errorf("count recent reports: %w", err)
		}
		if recent >= reportDailyLimit {
			return problem.TooManyRequests(rateLimitRetry)
		}
		created, err = q.InsertReport(ctx, store.InsertReportParams{
			ReporterID: reporterID, ReportedID: body.ReportedId, Reason: string(body.Reason), Comment: comment,
		})
		if isUniqueViolation(err) {
			return problem.Conflict("report_exists", "your report about this user is already being reviewed")
		}
		if err != nil {
			return fmt.Errorf("insert report: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return CreateReport201JSONResponse{
		Id: created.ID, ReportedId: created.ReportedID, Reason: ReportReason(created.Reason),
		Status: ReportStatus(created.Status), CreatedAt: created.CreatedAt,
	}, nil
}

type reportCursor struct {
	Version int       `json:"v"`
	Status  string    `json:"status"`
	ID      uuid.UUID `json:"id"`
}

// ListAdminReports returns the moderation queue in arrival order.
func (s *Server) ListAdminReports(ctx context.Context, request ListAdminReportsRequestObject) (ListAdminReportsResponseObject, error) {
	if err := requireAdmin(ctx); err != nil {
		return nil, err
	}
	params := request.Params
	status := Open
	if params.Status != nil {
		status = *params.Status
	}
	size := int32(defaultPageSize)
	if params.Limit != nil {
		size = *params.Limit
	}
	var after uuid.UUID
	hasCursor := params.Cursor != nil
	if hasCursor {
		raw, err := base64.RawURLEncoding.DecodeString(*params.Cursor)
		var position reportCursor
		if err != nil || json.Unmarshal(raw, &position) != nil || position.Version != 1 || position.Status != string(status) {
			return nil, problem.InvalidRequest("cursor is not valid")
		}
		after = position.ID
	}
	rows, err := s.queries.ListAdminReports(ctx, store.ListAdminReportsParams{
		Status: string(status), HasCursor: hasCursor, AfterID: after, PageSize: size + 1,
	})
	if err != nil {
		return nil, fmt.Errorf("list reports: %w", err)
	}
	var next *string
	if len(rows) > int(size) {
		rows = rows[:size]
		raw, _ := json.Marshal(reportCursor{Version: 1, Status: string(status), ID: rows[len(rows)-1].ID})
		cursor := base64.RawURLEncoding.EncodeToString(raw)
		next = &cursor
	}
	items := make([]AdminReport, 0, len(rows))
	for _, r := range rows {
		items = append(items, adminReport(store.Report{
			ID: r.ID, ReporterID: r.ReporterID, ReportedID: r.ReportedID, Reason: r.Reason,
			Comment: r.Comment, Status: r.Status, CreatedAt: r.CreatedAt, ResolvedAt: r.ResolvedAt,
		}, r.ReportedOpenCount))
	}
	return ListAdminReports200JSONResponse{Items: items, NextCursor: next}, nil
}

// ResolveAdminReport marks a report reviewed. Measures against the profile are
// taken separately in the Profile admin API.
func (s *Server) ResolveAdminReport(ctx context.Context, request ResolveAdminReportRequestObject) (ResolveAdminReportResponseObject, error) {
	if err := requireAdmin(ctx); err != nil {
		return nil, err
	}
	resolved, err := s.queries.ResolveReport(ctx, request.ReportId)
	if errors.Is(err, pgx.ErrNoRows) {
		exists, err := s.queries.ReportExists(ctx, request.ReportId)
		if err != nil {
			return nil, fmt.Errorf("check report: %w", err)
		}
		if exists {
			return nil, problem.Conflict("already_resolved", "the report has already been resolved")
		}
		return nil, problem.NotFound("report_not_found", "no such report")
	}
	if err != nil {
		return nil, fmt.Errorf("resolve report: %w", err)
	}
	openCount, err := s.queries.CountOpenReportsAbout(ctx, resolved.ReportedID)
	if err != nil {
		return nil, fmt.Errorf("count open reports: %w", err)
	}
	return ResolveAdminReport200JSONResponse(adminReport(resolved, openCount)), nil
}

func adminReport(r store.Report, openCount int64) AdminReport {
	return AdminReport{
		Id: r.ID, ReporterId: r.ReporterID, ReportedId: r.ReportedID, Reason: ReportReason(r.Reason),
		Comment: r.Comment, Status: ReportStatus(r.Status), CreatedAt: r.CreatedAt,
		ResolvedAt: optionalTime(r.ResolvedAt), ReportedOpenCount: openCount,
	}
}

func optionalTime(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

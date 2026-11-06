package api

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"sozhiteli.internal/matching/internal/compare"
	"sozhiteli.internal/matching/internal/store"
	"sozhiteli.internal/platform/auth"
	"sozhiteli.internal/platform/problem"
)

// Server implements the public Matching API (StrictServerInterface, generated
// from contracts/openapi/matching.v1.yaml).
//
// Every operation reads ONLY the Matching database (the candidate projection);
// no operation calls another service.
type Server struct {
	queries *store.Queries
	now     func() time.Time
}

// NewServer returns the public API implementation.
func NewServer(queries *store.Queries) *Server {
	return &Server{queries: queries, now: time.Now}
}

var _ StrictServerInterface = (*Server)(nil)

const (
	defaultPageSize = 20
	// profileNotReadyRetry is when a client should ask again after saving its
	// profile: a little more than the default synchronisation interval.
	profileNotReadyRetry = 5 * time.Second
)

// viewer loads the caller's own profile from the projection. A profile that
// is missing there is either not created yet or not synchronised yet; both
// are answered with 409 profile_not_ready and Retry-After.
func (s *Server) viewer(ctx context.Context) (profile, error) {
	userID, err := auth.UserID(ctx)
	if err != nil {
		return profile{}, err
	}
	row, err := s.queries.GetCandidate(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		e := problem.Conflict("profile_not_ready", "profile is not created yet or not synchronised yet")
		e.RetryAfter = profileNotReadyRetry
		return profile{}, e
	}
	if err != nil {
		return profile{}, fmt.Errorf("load viewer profile: %w", err)
	}
	return decodeProfile(row)
}

// ListCandidates returns one page of candidates that pass the viewer's hard
// conditions, newest profiles first.
func (s *Server) ListCandidates(ctx context.Context, request ListCandidatesRequestObject) (ListCandidatesResponseObject, error) {
	after := feedStart
	if request.Params.Cursor != nil {
		var err error
		if after, err = decodeFeedCursor(*request.Params.Cursor); err != nil {
			return nil, problem.InvalidRequest("cursor is not valid")
		}
	}
	pageSize := int32(defaultPageSize)
	if request.Params.Limit != nil {
		pageSize = *request.Params.Limit
	}

	viewer, err := s.viewer(ctx)
	if err != nil {
		return nil, err
	}
	v := viewer.row

	// One row more than the page tells whether another page exists.
	rows, err := s.queries.ListFeed(ctx, store.ListFeedParams{
		CityID:               v.CityID,
		ViewerID:             v.UserID,
		BudgetMinRub:         v.BudgetMinRub,
		BudgetMaxRub:         v.BudgetMaxRub,
		MoveInFrom:           v.MoveInFrom,
		MoveInTo:             v.MoveInTo,
		ViewerGender:         v.Gender,
		ViewerRoommateGender: v.RoommateGender,
		AfterUpdatedAt:       after.UpdatedAt,
		AfterUserID:          after.UserID,
		PageSize:             pageSize + 1,
	})
	if err != nil {
		return nil, fmt.Errorf("list candidates: %w", err)
	}

	var next *string
	if len(rows) > int(pageSize) {
		rows = rows[:pageSize]
		last := rows[len(rows)-1]
		cursor := encodeFeedCursor(feedPosition{UpdatedAt: last.ProfileUpdatedAt, UserID: last.UserID})
		next = &cursor
	}

	now := s.now()
	items := make([]CandidateCard, 0, len(rows))
	for _, row := range rows {
		candidate, err := decodeProfile(row)
		if err != nil {
			return nil, err
		}
		items = append(items, card(viewer, candidate, now))
	}
	return ListCandidates200JSONResponse{Items: items, NextCursor: next}, nil
}

// GetCandidate returns one candidate with the comparison of conditions and
// habits, and records that the viewer saw it.
func (s *Server) GetCandidate(ctx context.Context, request GetCandidateRequestObject) (GetCandidateResponseObject, error) {
	viewer, err := s.viewer(ctx)
	if err != nil {
		return nil, err
	}
	notFound := problem.NotFound("candidate_not_found", "no such candidate")
	if request.UserId == viewer.row.UserID {
		return nil, notFound
	}
	row, err := s.queries.GetCandidate(ctx, request.UserId)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, notFound
	}
	if err != nil {
		return nil, fmt.Errorf("load candidate: %w", err)
	}
	candidate, err := decodeProfile(row)
	if err != nil {
		return nil, err
	}

	c := card(viewer, candidate, s.now())
	// Record views for auxiliary product analytics. Research outcomes require
	// participant reports; a view alone does not establish household influence.
	err = s.queries.RecordCandidateView(ctx, store.RecordCandidateViewParams{
		ViewerID:      viewer.row.UserID,
		CandidateID:   row.UserID,
		MatchedCount:  int16(c.Compatibility.MatchedCount),
		ComparedCount: int16(c.Compatibility.ComparedCount),
	})
	if err != nil {
		return nil, fmt.Errorf("record candidate view: %w", err)
	}

	conditions := compare.CompareConditions(viewer.conditions(), candidate.conditions())
	return GetCandidate200JSONResponse{
		Card: c,
		Conditions: ConditionsComparison{
			SameCity:         conditions.SameCity,
			BudgetOverlap:    conditions.BudgetOverlap,
			MoveInOverlap:    conditions.MoveInOverlap,
			RoommateGenderOk: conditions.RoommateGenderOK,
		},
		Habits: habitComparisons(viewer, candidate),
	}, nil
}

// LookupCandidates returns cards for the given users, in the order asked,
// without applying the hard conditions. Unknown identifiers and the
// caller's own identifier are silently left out.
func (s *Server) LookupCandidates(ctx context.Context, request LookupCandidatesRequestObject) (LookupCandidatesResponseObject, error) {
	if request.Body == nil {
		return nil, problem.InvalidRequest("request body is required")
	}
	viewer, err := s.viewer(ctx)
	if err != nil {
		return nil, err
	}

	ids := slices.DeleteFunc(slices.Clone(request.Body.UserIds), func(id uuid.UUID) bool {
		return id == viewer.row.UserID
	})
	rows, err := s.queries.ListCandidatesByID(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("look up candidates: %w", err)
	}
	byID := make(map[uuid.UUID]store.Candidate, len(rows))
	for _, row := range rows {
		byID[row.UserID] = row
	}

	now := s.now()
	items := make([]CandidateCard, 0, len(rows))
	for _, id := range ids {
		row, ok := byID[id]
		if !ok {
			continue
		}
		candidate, err := decodeProfile(row)
		if err != nil {
			return nil, err
		}
		items = append(items, card(viewer, candidate, now))
	}
	return LookupCandidates200JSONResponse{Items: items}, nil
}

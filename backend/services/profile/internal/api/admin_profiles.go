package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"sozhiteli.internal/platform/auth"
	"sozhiteli.internal/platform/problem"
	"sozhiteli.internal/profile/internal/store"
)

// Administrative operations on profiles. Every one of them checks the
// sozhiteli-admin role first; the identity of the administrator is only used
// for the audit record.

// ListAdminProfiles returns full profiles to an administrator. Keyset pagination
// by user identifier; the cursor is bound to the search text, so a page from one
// search cannot be replayed against another.
func (s *Server) ListAdminProfiles(ctx context.Context, request ListAdminProfilesRequestObject) (ListAdminProfilesResponseObject, error) {
	if err := requireAdmin(ctx); err != nil {
		return nil, err
	}
	limit, err := adminPageLimit(request.Params.Limit)
	if err != nil {
		return nil, err
	}
	needle := ""
	if request.Params.Search != nil {
		needle = strings.TrimSpace(*request.Params.Search)
		if utf8.RuneCountInString(needle) > 128 {
			return nil, problem.InvalidRequest("search is too long")
		}
	}
	hash := sha256.Sum256([]byte(needle))
	scope := "profiles:" + hex.EncodeToString(hash[:])
	position, err := decodeAdminCursor(request.Params.Cursor, scope)
	if err != nil {
		return nil, err
	}
	after := uuid.Nil
	if position != "" {
		after, err = uuid.Parse(position)
		if err != nil {
			return nil, problem.InvalidRequest("cursor is invalid")
		}
	}
	rows, err := s.queries.AdminSearchProfiles(ctx, store.AdminSearchProfilesParams{
		HasAfter: position != "", AfterID: after, Needle: needle, RowLimit: int32(limit + 1),
	})
	if err != nil {
		return nil, fmt.Errorf("search profiles: %w", err)
	}
	var next *string
	if len(rows) > limit {
		rows = rows[:limit]
		cursor := encodeAdminCursor(scope, rows[len(rows)-1].UserID.String())
		next = &cursor
	}
	items := make([]Profile, 0, len(rows))
	for _, row := range rows {
		profile, err := profileFromRow(row)
		if err != nil {
			return nil, err
		}
		items = append(items, profile)
	}
	return ListAdminProfiles200JSONResponse{Items: items, NextCursor: next}, nil
}

// GetAdminProfile returns any user's profile to an administrator.
func (s *Server) GetAdminProfile(ctx context.Context, request GetAdminProfileRequestObject) (GetAdminProfileResponseObject, error) {
	if err := requireAdmin(ctx); err != nil {
		return nil, err
	}
	row, err := s.queries.GetProfile(ctx, request.UserId)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, problem.NotFound("profile_not_found", "profile has not been created yet")
	}
	if err != nil {
		return nil, fmt.Errorf("load profile: %w", err)
	}
	profile, err := profileFromRow(row)
	if err != nil {
		return nil, err
	}
	return GetAdminProfile200JSONResponse(profile), nil
}

// PutAdminProfile creates or replaces a user's profile. Creating one requires
// that the account exists in the identity provider, so profiles cannot be
// attached to made-up identifiers. Replacing an existing profile does not
// consult the provider.
func (s *Server) PutAdminProfile(ctx context.Context, request PutAdminProfileRequestObject) (PutAdminProfileResponseObject, error) {
	if err := requireAdmin(ctx); err != nil {
		return nil, err
	}
	admin, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if request.Body == nil {
		return nil, problem.InvalidRequest("request body is required")
	}
	action := "update"
	_, err = s.queries.GetProfile(ctx, request.UserId)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		action = "create"
		found, err := s.userExists(ctx, request.UserId)
		if err != nil {
			return nil, err
		}
		if !found {
			return nil, problem.NotFound("user_not_found", "no account with this identifier")
		}
	case err != nil:
		return nil, fmt.Errorf("load profile: %w", err)
	}
	profile, err := s.saveProfile(ctx, request.UserId, *request.Body)
	if err != nil {
		return nil, err
	}
	s.recordAdminChange(ctx, action, admin, request.UserId)
	return PutAdminProfile200JSONResponse(profile), nil
}

// DeleteAdminProfile removes only the profile. The account, contacts and contact
// requests stay as they are. The database trigger writes the deletion marker
// that removes the candidate from Matching.
func (s *Server) DeleteAdminProfile(ctx context.Context, request DeleteAdminProfileRequestObject) (DeleteAdminProfileResponseObject, error) {
	if err := requireAdmin(ctx); err != nil {
		return nil, err
	}
	admin, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	deleted, err := s.queries.DeleteProfile(ctx, request.UserId)
	if err != nil {
		return nil, fmt.Errorf("delete profile: %w", err)
	}
	if deleted == 0 {
		return nil, problem.NotFound("profile_not_found", "profile has not been created yet")
	}
	s.recordAdminChange(ctx, "delete", admin, request.UserId)
	return DeleteAdminProfile204Response{}, nil
}

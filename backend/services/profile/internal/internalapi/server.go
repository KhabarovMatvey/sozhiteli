package internalapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"sozhiteli.internal/platform/problem"
	"sozhiteli.internal/profile/internal/changefeed"
	"sozhiteli.internal/profile/internal/store"
)

// RoleReadProfileChanges is the realm role a service needs to read the feed.
const RoleReadProfileChanges = "internal.profile-changes.read"

const defaultPageSize = 200

// Server implements the internal Profile API (StrictServerInterface, generated
// from contracts/openapi/profile-internal.v1.yaml).
type Server struct {
	queries *store.Queries
}

// NewServer returns the internal API implementation.
func NewServer(queries *store.Queries) *Server {
	return &Server{queries: queries}
}

var _ StrictServerInterface = (*Server)(nil)

// ListProfileChanges returns one page of the profile change feed (ADR-0004).
func (s *Server) ListProfileChanges(ctx context.Context, request ListProfileChangesRequestObject) (ListProfileChangesResponseObject, error) {
	cursor := ""
	if request.Params.Cursor != nil {
		cursor = *request.Params.Cursor
	}
	limit := int32(defaultPageSize)
	if request.Params.Limit != nil {
		limit = *request.Params.Limit
	}

	after, err := changefeed.DecodeCursor(cursor)
	if errors.Is(err, changefeed.ErrInvalidCursor) {
		return nil, problem.InvalidRequest("cursor is not valid")
	}

	// The horizon is read first and then used as a fixed upper bound: rows
	// below it were written by transactions that had already finished, so they
	// cannot appear later and no consumer can skip them.
	horizon, err := s.queries.GetFeedHorizon(ctx)
	if err != nil {
		return nil, fmt.Errorf("read feed horizon: %w", err)
	}

	changedRows, err := s.queries.ListChangedProfiles(ctx, store.ListChangedProfilesParams{
		AfterVersion: after.Version,
		AfterUserID:  after.UserID,
		Horizon:      horizon,
		PageSize:     limit,
	})
	if err != nil {
		return nil, fmt.Errorf("list changed profiles: %w", err)
	}
	deletedRows, err := s.queries.ListDeletedProfiles(ctx, store.ListDeletedProfilesParams{
		AfterVersion: after.Version,
		AfterUserID:  after.UserID,
		Horizon:      horizon,
		PageSize:     limit,
	})
	if err != nil {
		return nil, fmt.Errorf("list deleted profiles: %w", err)
	}

	changed := make([]changefeed.Entry[*ProfileSnapshot], 0, len(changedRows))
	for _, row := range changedRows {
		snapshot, err := snapshotFromRow(row)
		if err != nil {
			return nil, err
		}
		changed = append(changed, changefeed.Entry[*ProfileSnapshot]{
			Position: changefeed.Position{Version: row.FeedVersion, UserID: row.UserID},
			Payload:  snapshot,
		})
	}
	deleted := make([]changefeed.Entry[*ProfileSnapshot], 0, len(deletedRows))
	for _, row := range deletedRows {
		deleted = append(deleted, changefeed.Entry[*ProfileSnapshot]{
			Position: changefeed.Position{Version: row.FeedVersion, UserID: row.UserID},
			Deleted:  true,
		})
	}

	page := changefeed.Merge(changed, deleted, int(limit))

	items := make([]ProfileChange, 0, len(page))
	for _, entry := range page {
		items = append(items, ProfileChange{
			UserId:  entry.Position.UserID,
			Version: entry.Position.Version,
			Deleted: entry.Deleted,
			Profile: entry.Payload,
		})
	}
	return ListProfileChanges200JSONResponse{
		Items:      items,
		NextCursor: changefeed.NextCursor(cursor, page),
	}, nil
}

func snapshotFromRow(row store.ListChangedProfilesRow) (*ProfileSnapshot, error) {
	habits := map[string]string{}
	if err := json.Unmarshal(row.Habits, &habits); err != nil {
		return nil, fmt.Errorf("decode habits of profile %s: %w", row.UserID, err)
	}
	return &ProfileSnapshot{
		DisplayName:          row.DisplayName,
		BirthYear:            int32(row.BirthYear),
		Gender:               ProfileSnapshotGender(row.Gender),
		Occupation:           row.Occupation,
		CityId:               int32(row.CityID),
		Districts:            row.Districts,
		BudgetMinRub:         row.BudgetMinRub,
		BudgetMaxRub:         row.BudgetMaxRub,
		MoveInFrom:           openapi_types.Date{Time: row.MoveInFrom},
		MoveInTo:             openapi_types.Date{Time: row.MoveInTo},
		RoommateGender:       ProfileSnapshotRoommateGender(row.RoommateGender),
		QuestionnaireVersion: row.QuestionnaireVersion,
		Habits:               habits,
		SearchStatus:         ProfileSnapshotSearchStatus(row.SearchStatus),
		Scenario:             ProfileSnapshotScenario(row.Scenario),
		AcceptsRoom:          row.AcceptsRoom,
		UtilitiesRub:         optionalInt(row.UtilitiesRub),
		DepositRub:           optionalInt(row.DepositRub),
		PlaceNote:            row.PlaceNote,
		RequiredHabits:       row.RequiredHabits,
		UpdatedAt:            row.UpdatedAt,
	}, nil
}

func optionalInt(v pgtype.Int4) *int32 {
	if !v.Valid {
		return nil
	}
	n := v.Int32
	return &n
}

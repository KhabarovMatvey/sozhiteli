package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"sozhiteli.internal/matching/internal/store"
	"sozhiteli.internal/platform/auth"
	"sozhiteli.internal/platform/problem"
)

const adminRole = "sozhiteli-admin"

// Apply before authentication so every admin response, including denials,
// prevents storage of sensitive administrative data by browsers or proxies.
func adminNoStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/v1/admin/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

type adminTableDefinition struct {
	name, label string
	columns     []string
}

// This allowlist determines both metadata and the readable columns. SQL queries
// below are generated from fixed source; no client input becomes an identifier.
var adminTables = []adminTableDefinition{
	{name: "candidate", label: "Анкеты в проекции", columns: []string{"user_id", "source_version", "display_name", "birth_year", "gender", "occupation", "city_id", "districts", "budget_min_rub", "budget_max_rub", "move_in_from", "move_in_to", "roommate_gender", "questionnaire_version", "habits", "search_status", "profile_updated_at", "synced_at"}},
	{name: "candidate_view", label: "Просмотры анкет", columns: []string{"id", "viewer_id", "candidate_id", "matched_count", "compared_count", "viewed_at"}},
	{name: "sync_state", label: "Синхронизация проекции", columns: []string{"source", "feed_cursor", "updated_at"}},
}

func requireAdmin(ctx context.Context) error {
	if _, err := auth.UserID(ctx); err != nil {
		return err
	}
	principal, _ := auth.PrincipalFrom(ctx)
	if !principal.HasRole(adminRole) {
		return problem.Forbidden()
	}
	return nil
}

// GetAdminDatabase reads only this service's database after checking the role.
func (s *Server) GetAdminDatabase(ctx context.Context, _ GetAdminDatabaseRequestObject) (GetAdminDatabaseResponseObject, error) {
	if err := requireAdmin(ctx); err != nil {
		return nil, err
	}
	row, err := s.queries.GetAdminDatabase(ctx)
	if err != nil {
		return nil, fmt.Errorf("read admin database: %w", err)
	}
	counts := []int64{row.CandidateCount, row.CandidateViewCount, row.SyncStateCount}
	tables := make([]AdminTableSummary, 0, len(adminTables))
	for i, table := range adminTables {
		tables = append(tables, AdminTableSummary{Name: table.name, Label: table.label, Columns: table.columns, RowCount: counts[i]})
	}
	return GetAdminDatabase200JSONResponse{Service: "matching", Database: row.Database, SizeBytes: row.SizeBytes, Tables: tables}, nil
}

type adminRecord struct {
	key  string
	data []byte
}

type adminCursor struct {
	Version int    `json:"v"`
	Service string `json:"service"`
	Table   string `json:"table"`
	Key     string `json:"key"`
}

func encodeAdminCursor(table, key string) string {
	raw, _ := json.Marshal(adminCursor{Version: 1, Service: "matching", Table: table, Key: key})
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeAdminCursor(table, cursor string) (string, error) {
	if len(cursor) > 512 {
		return "", problem.InvalidRequest("cursor is not valid for this table")
	}
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return "", problem.InvalidRequest("cursor is not valid for this table")
	}
	var position adminCursor
	if err := json.Unmarshal(raw, &position); err != nil || position.Version != 1 || position.Service != "matching" || position.Table != table {
		return "", problem.InvalidRequest("cursor is not valid for this table")
	}
	return position.Key, nil
}

// ListAdminTableRows uses primary-key pagination and never reads private contact values.
func (s *Server) ListAdminTableRows(ctx context.Context, request ListAdminTableRowsRequestObject) (ListAdminTableRowsResponseObject, error) {
	if err := requireAdmin(ctx); err != nil {
		return nil, err
	}
	var columns []string
	for _, table := range adminTables {
		if table.name == request.Table {
			columns = table.columns
			break
		}
	}
	if columns == nil {
		return nil, problem.NotFound("admin_table_not_found", "table is not available")
	}
	size := int32(defaultPageSize)
	if request.Params.Limit != nil {
		size = *request.Params.Limit
	}
	if size < 1 || size > 50 {
		return nil, problem.InvalidRequest("limit must be between 1 and 50")
	}
	hasCursor := request.Params.Cursor != nil
	var key string
	var err error
	if hasCursor {
		key, err = decodeAdminCursor(request.Table, *request.Params.Cursor)
		if err != nil {
			return nil, err
		}
	}
	records := make([]adminRecord, 0, size+1)
	switch request.Table {
	case "candidate":
		var id uuid.UUID
		if hasCursor {
			id, err = uuid.Parse(key)
		}
		if err != nil {
			return nil, problem.InvalidRequest("cursor is not valid for this table")
		}
		rows, err := s.queries.ListAdminCandidates(ctx, store.ListAdminCandidatesParams{HasCursor: hasCursor, AfterID: id, PageSize: size + 1})
		if err != nil {
			return nil, fmt.Errorf("read admin candidates: %w", err)
		}
		for _, row := range rows {
			records = append(records, adminRecord{key: row.KeyID.String(), data: row.RowData})
		}
	case "candidate_view":
		var id int64
		if hasCursor {
			id, err = strconv.ParseInt(key, 10, 64)
		}
		if err != nil {
			return nil, problem.InvalidRequest("cursor is not valid for this table")
		}
		rows, err := s.queries.ListAdminCandidateViews(ctx, store.ListAdminCandidateViewsParams{HasCursor: hasCursor, AfterID: id, PageSize: size + 1})
		if err != nil {
			return nil, fmt.Errorf("read admin candidate views: %w", err)
		}
		for _, row := range rows {
			records = append(records, adminRecord{key: strconv.FormatInt(row.KeyID, 10), data: row.RowData})
		}
	case "sync_state":
		rows, err := s.queries.ListAdminSyncStates(ctx, store.ListAdminSyncStatesParams{HasCursor: hasCursor, AfterSource: key, PageSize: size + 1})
		if err != nil {
			return nil, fmt.Errorf("read admin sync state: %w", err)
		}
		for _, row := range rows {
			records = append(records, adminRecord{key: row.KeySource, data: row.RowData})
		}
	}
	var next *string
	if len(records) > int(size) {
		records = records[:size]
		cursor := encodeAdminCursor(request.Table, records[len(records)-1].key)
		next = &cursor
	}
	rows := make([][]string, 0, len(records))
	for _, record := range records {
		cells, err := adminRowStrings(record.data)
		if err != nil {
			return nil, fmt.Errorf("decode admin row: %w", err)
		}
		rows = append(rows, cells)
	}
	return ListAdminTableRows200JSONResponse{Table: request.Table, Columns: columns, Rows: rows, NextCursor: next}, nil
}

func adminRowStrings(raw []byte) ([]string, error) {
	var cells []json.RawMessage
	if err := json.Unmarshal(raw, &cells); err != nil {
		return nil, err
	}
	result := make([]string, 0, len(cells))
	for _, cell := range cells {
		var value string
		if string(cell) == "null" {
			result = append(result, "")
			continue
		}
		if err := json.Unmarshal(cell, &value); err != nil {
			value = string(cell)
		}
		result = append(result, value)
	}
	return result, nil
}

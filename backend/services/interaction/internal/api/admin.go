package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"sozhiteli.internal/interaction/internal/store"
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
	{name: "contact_request", label: "Запросы на контакт", columns: []string{"id", "sender_id", "recipient_id", "status", "created_at", "responded_at"}},
	{name: "contact", label: "Контакты без значений", columns: []string{"user_id", "kind", "updated_at"}},
	{name: "user_block", label: "Блокировки", columns: []string{"blocker_id", "blocked_id", "created_at"}},
	{name: "report", label: "Жалобы без комментариев", columns: []string{"id", "reporter_id", "reported_id", "reason", "status", "created_at", "resolved_at"}},
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
	counts := []int64{row.ContactRequestCount, row.ContactCount, row.UserBlockCount, row.ReportCount}
	tables := make([]AdminTableSummary, 0, len(adminTables))
	for i, table := range adminTables {
		tables = append(tables, AdminTableSummary{Name: table.name, Label: table.label, Columns: table.columns, RowCount: counts[i]})
	}
	return GetAdminDatabase200JSONResponse{Service: "interaction", Database: row.Database, SizeBytes: row.SizeBytes, Tables: tables}, nil
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
	raw, _ := json.Marshal(adminCursor{Version: 1, Service: "interaction", Table: table, Key: key})
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
	if err := json.Unmarshal(raw, &position); err != nil || position.Version != 1 || position.Service != "interaction" || position.Table != table {
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
	case "user_block":
		var blocker, blocked uuid.UUID
		if hasCursor {
			first, second, ok := strings.Cut(key, "/")
			if !ok {
				return nil, problem.InvalidRequest("cursor is not valid for this table")
			}
			if blocker, err = uuid.Parse(first); err == nil {
				blocked, err = uuid.Parse(second)
			}
			if err != nil {
				return nil, problem.InvalidRequest("cursor is not valid for this table")
			}
		}
		rows, err := s.queries.ListAdminUserBlocks(ctx, store.ListAdminUserBlocksParams{HasCursor: hasCursor, AfterBlocker: blocker, AfterBlocked: blocked, PageSize: size + 1})
		if err != nil {
			return nil, fmt.Errorf("read admin blocks: %w", err)
		}
		for _, row := range rows {
			records = append(records, adminRecord{key: row.KeyID, data: row.RowData})
		}
	case "report":
		var id uuid.UUID
		if hasCursor {
			if id, err = uuid.Parse(key); err != nil {
				return nil, problem.InvalidRequest("cursor is not valid for this table")
			}
		}
		rows, err := s.queries.ListAdminReportRows(ctx, store.ListAdminReportRowsParams{HasCursor: hasCursor, AfterID: id, PageSize: size + 1})
		if err != nil {
			return nil, fmt.Errorf("read admin reports: %w", err)
		}
		for _, row := range rows {
			records = append(records, adminRecord{key: row.KeyID.String(), data: row.RowData})
		}
	case "contact_request", "contact":
		var id uuid.UUID
		if hasCursor {
			id, err = uuid.Parse(key)
		}
		if err != nil {
			return nil, problem.InvalidRequest("cursor is not valid for this table")
		}
		if request.Table == "contact_request" {
			rows, err := s.queries.ListAdminContactRequests(ctx, store.ListAdminContactRequestsParams{HasCursor: hasCursor, AfterID: id, PageSize: size + 1})
			if err != nil {
				return nil, fmt.Errorf("read admin contact requests: %w", err)
			}
			for _, row := range rows {
				records = append(records, adminRecord{key: row.KeyID.String(), data: row.RowData})
			}
		} else {
			rows, err := s.queries.ListAdminContacts(ctx, store.ListAdminContactsParams{HasCursor: hasCursor, AfterID: id, PageSize: size + 1})
			if err != nil {
				return nil, fmt.Errorf("read admin contacts: %w", err)
			}
			for _, row := range rows {
				records = append(records, adminRecord{key: row.KeyID.String(), data: row.RowData})
			}
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

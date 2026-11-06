package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"sozhiteli.internal/platform/auth"
	"sozhiteli.internal/platform/problem"
	"sozhiteli.internal/profile/internal/adminusers"
	"sozhiteli.internal/profile/internal/store"
)

// AdminRole is never a default realm role or a role of the public OIDC client.
const AdminRole = "sozhiteli-admin"

// AdminUserDirectory is read-only and intentionally accepts no arbitrary URLs,
// Keycloak paths or user mutations.
type AdminUserDirectory interface {
	List(context.Context, int, int, string) (adminusers.Page, error)
	Exists(context.Context, uuid.UUID) (bool, error)
}

// WithAdminUsers adds optional directory access without changing callers that
// only construct the ordinary Profile API. A typed nil client is safe as well.
func (s *Server) WithAdminUsers(directory AdminUserDirectory) *Server {
	s.adminUsers = directory
	return s
}

// WithAuditLog records every administrative change to a profile. Entries carry
// the operation, the administrator and the affected user identifier only: never
// profile values, contacts or tokens.
func (s *Server) WithAuditLog(logger *slog.Logger) *Server {
	s.audit = logger
	return s
}

func (s *Server) recordAdminChange(ctx context.Context, action string, admin, target uuid.UUID) {
	if s.audit == nil {
		return
	}
	s.audit.InfoContext(ctx, "admin profile change",
		"action", action, "admin_user_id", admin.String(), "target_user_id", target.String())
}

// userExists asks the identity provider. Without a configured directory the
// check cannot be made, so creating a profile is refused rather than guessed.
func (s *Server) userExists(ctx context.Context, id uuid.UUID) (bool, error) {
	if s.adminUsers == nil {
		return false, problem.Unavailable(time.Second)
	}
	found, err := s.adminUsers.Exists(ctx, id)
	if err != nil {
		// Upstream details are logged by the directory client without credentials.
		return false, problem.Unavailable(time.Second)
	}
	return found, nil
}

func requireAdmin(ctx context.Context) error {
	if _, err := auth.UserID(ctx); err != nil {
		return err
	}
	principal, ok := auth.PrincipalFrom(ctx)
	if !ok || !principal.HasRole(AdminRole) {
		return problem.Forbidden()
	}
	return nil
}

type adminTable struct {
	label   string
	columns []string
}

var adminTables = map[string]adminTable{
	"profile": {label: "Анкеты пользователей", columns: []string{
		"user_id", "display_name", "birth_year", "gender", "occupation", "city_id", "districts",
		"budget_min_rub", "budget_max_rub", "move_in_from", "move_in_to", "roommate_gender",
		"questionnaire_version", "habits", "search_status", "created_at", "updated_at", "feed_version",
	}},
	"city":             {label: "Города", columns: []string{"id", "name", "region"}},
	"profile_deletion": {label: "Удалённые анкеты", columns: []string{"user_id", "feed_version", "deleted_at"}},
}

// GetAdminDatabase reports only the database owned by this service. No runtime
// role is expanded and no connection details are returned to the browser.
func (s *Server) GetAdminDatabase(ctx context.Context, _ GetAdminDatabaseRequestObject) (GetAdminDatabaseResponseObject, error) {
	if err := requireAdmin(ctx); err != nil {
		return nil, err
	}
	info, err := s.queries.AdminDatabaseInfo(ctx)
	if err != nil {
		return nil, fmt.Errorf("read admin database summary: %w", err)
	}
	counts, err := s.queries.AdminTableCounts(ctx)
	if err != nil {
		return nil, fmt.Errorf("read admin table counts: %w", err)
	}
	tables := make([]AdminTableSummary, 0, len(counts))
	for _, row := range counts {
		definition, ok := adminTables[row.TableName]
		if !ok {
			continue
		}
		tables = append(tables, AdminTableSummary{
			Name: row.TableName, Label: definition.label, RowCount: row.RowCount, Columns: definition.columns,
		})
	}
	return GetAdminDatabase200JSONResponse{
		Service: "profile", Database: info.DatabaseName, SizeBytes: info.SizeBytes, Tables: tables,
	}, nil
}

// ListAdminTableRows dispatches only static queries. A keyset cursor is bound
// to its table; reading a new table cannot silently reuse the previous cursor.
func (s *Server) ListAdminTableRows(ctx context.Context, request ListAdminTableRowsRequestObject) (ListAdminTableRowsResponseObject, error) {
	if err := requireAdmin(ctx); err != nil {
		return nil, err
	}
	table := string(request.Table)
	definition, ok := adminTables[table]
	if !ok {
		return nil, problem.NotFound("not_found", "table is not available")
	}
	limit, err := adminPageLimit(request.Params.Limit)
	if err != nil {
		return nil, err
	}
	position, err := decodeAdminCursor(request.Params.Cursor, "profile:"+table)
	if err != nil {
		return nil, err
	}
	var rows [][]string
	switch table {
	case "city":
		var after int64
		if position != "" {
			after, err = strconv.ParseInt(position, 10, 16)
			if err != nil || after < 1 {
				return nil, problem.InvalidRequest("cursor is invalid")
			}
		}
		rows, err = s.queries.AdminListCities(ctx, store.AdminListCitiesParams{
			HasAfter: position != "", AfterID: int16(after), RowLimit: int32(limit + 1),
		})
	case "profile", "profile_deletion":
		after := uuid.Nil
		if position != "" {
			after, err = uuid.Parse(position)
			if err != nil {
				return nil, problem.InvalidRequest("cursor is invalid")
			}
		}
		if table == "profile" {
			rows, err = s.queries.AdminListProfiles(ctx, store.AdminListProfilesParams{
				HasAfter: position != "", AfterID: after, RowLimit: int32(limit + 1),
			})
		} else {
			rows, err = s.queries.AdminListProfileDeletions(ctx, store.AdminListProfileDeletionsParams{
				HasAfter: position != "", AfterID: after, RowLimit: int32(limit + 1),
			})
		}
	}
	if err != nil {
		return nil, fmt.Errorf("read admin table rows: %w", err)
	}
	var next *string
	if len(rows) > limit {
		rows = rows[:limit]
		cursor := encodeAdminCursor("profile:"+table, rows[len(rows)-1][0])
		next = &cursor
	}
	if rows == nil {
		rows = [][]string{}
	}
	return ListAdminTableRows200JSONResponse{
		Table: table, Columns: definition.columns, Rows: rows, NextCursor: next,
	}, nil
}

// ListAdminUsers uses the identity provider rather than treating a profile as
// evidence of registration. Accounts without a profile are therefore included.
func (s *Server) ListAdminUsers(ctx context.Context, request ListAdminUsersRequestObject) (ListAdminUsersResponseObject, error) {
	if err := requireAdmin(ctx); err != nil {
		return nil, err
	}
	limit, err := adminPageLimit(request.Params.Limit)
	if err != nil {
		return nil, err
	}
	search := ""
	if request.Params.Search != nil {
		search = strings.TrimSpace(*request.Params.Search)
		if utf8.RuneCountInString(search) > 128 {
			return nil, problem.InvalidRequest("search is too long")
		}
	}
	hash := sha256.Sum256([]byte(search))
	scope := "users:" + hex.EncodeToString(hash[:])
	position, err := decodeAdminCursor(request.Params.Cursor, scope)
	if err != nil {
		return nil, err
	}
	first := 0
	if position != "" {
		parsed, parseErr := strconv.ParseInt(position, 10, 32)
		if parseErr != nil || parsed < 1 || parsed > math.MaxInt32-50 {
			return nil, problem.InvalidRequest("cursor is invalid")
		}
		first = int(parsed)
	}
	if s.adminUsers == nil {
		return nil, problem.Unavailable(time.Second)
	}
	page, err := s.adminUsers.List(ctx, first, limit, search)
	if err != nil {
		// Never log upstream bodies, tokens, credentials or directory details.
		return nil, problem.Unavailable(time.Second)
	}
	// One query per page tells which accounts already have a profile.
	ids := make([]uuid.UUID, 0, len(page.Users))
	for _, user := range page.Users {
		ids = append(ids, user.ID)
	}
	withProfile := map[uuid.UUID]bool{}
	if len(ids) > 0 {
		found, err := s.queries.AdminProfileIDs(ctx, ids)
		if err != nil {
			return nil, fmt.Errorf("read profile identifiers: %w", err)
		}
		for _, id := range found {
			withProfile[id] = true
		}
	}
	items := make([]AdminUser, 0, len(page.Users))
	for _, user := range page.Users {
		items = append(items, AdminUser{
			Id: user.ID, Username: user.Username, Email: user.Email, Enabled: user.Enabled,
			EmailVerified: user.EmailVerified, CreatedAt: user.CreatedAt, ServiceAccount: user.ServiceAccount,
			HasProfile: withProfile[user.ID],
		})
	}
	var next *string
	if len(items) == limit && int64(first+len(items)) < page.Total {
		cursor := encodeAdminCursor(scope, strconv.Itoa(first+len(items)))
		next = &cursor
	}
	return ListAdminUsers200JSONResponse{Items: items, Total: page.Total, NextCursor: next}, nil
}

func adminPageLimit(value *int32) (int, error) {
	limit := 20
	if value != nil {
		limit = int(*value)
	}
	if limit < 1 || limit > 50 {
		return 0, problem.InvalidRequest("limit must be between 1 and 50")
	}
	return limit, nil
}

type adminCursor struct {
	Version int    `json:"v"`
	Scope   string `json:"s"`
	Key     string `json:"k"`
}

func encodeAdminCursor(scope, key string) string {
	raw, _ := json.Marshal(adminCursor{Version: 1, Scope: scope, Key: key})
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeAdminCursor(value *string, scope string) (string, error) {
	if value == nil {
		return "", nil
	}
	if len(*value) == 0 || len(*value) > 1024 {
		return "", problem.InvalidRequest("cursor is invalid")
	}
	raw, err := base64.RawURLEncoding.DecodeString(*value)
	if err != nil {
		return "", problem.InvalidRequest("cursor is invalid")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var cursor adminCursor
	if err := decoder.Decode(&cursor); err != nil || cursor.Version != 1 || cursor.Scope != scope || cursor.Key == "" {
		return "", problem.InvalidRequest("cursor is invalid")
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return "", problem.InvalidRequest("cursor is invalid")
	}
	return cursor.Key, nil
}

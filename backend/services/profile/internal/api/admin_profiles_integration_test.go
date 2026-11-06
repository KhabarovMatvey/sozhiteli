//go:build integration

package api_test

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"sozhiteli.internal/platform/auth"
	"sozhiteli.internal/platform/openapi/openapitest"
	"sozhiteli.internal/profile/internal/adminusers"
	"sozhiteli.internal/profile/internal/api"
)

// newAdminDBFixture is newDBFixture with an identity directory and an audit log
// wired in, as the real service wires them.
func newAdminDBFixture(t *testing.T, directory api.AdminUserDirectory, audit *slog.Logger) dbFixture {
	t.Helper()
	f := newDBFixture(t)
	server := api.NewServer(f.queries).WithAdminUsers(directory)
	if audit != nil {
		server = server.WithAuditLog(audit)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler, err := api.NewHandler(logger, auth.NewVerifier(f.issuer.Config(audience)), server)
	if err != nil {
		t.Fatal(err)
	}
	f.handler = handler
	return f
}

func createOwnProfile(t *testing.T, f dbFixture, id, name string) {
	t.Helper()
	body := validProfile()
	body["display_name"] = name
	_, rec := f.do(http.MethodPut, "/v1/me/profile", f.tokenFor(t, id), encode(t, body))
	if rec.Code != http.StatusOK {
		t.Fatalf("own profile for %s: status=%d body=%s", id, rec.Code, rec.Body.String())
	}
}

const (
	adminCreateID  = "00000000-0000-0000-0000-0000000000a1"
	adminMissingID = "00000000-0000-0000-0000-0000000000a2"
	adminNoAcctID  = "00000000-0000-0000-0000-0000000000a3"
)

func TestAdminCreatesProfilesOnlyForExistingAccounts(t *testing.T) {
	directory := &directoryStub{exists: func(id uuid.UUID) (bool, error) {
		return id.String() == adminCreateID, nil
	}}
	f := newAdminDBFixture(t, directory, nil)
	token := adminToken(f.fixture)

	req, rec := f.do(http.MethodPut, "/v1/admin/users/"+adminCreateID+"/profile", token, encode(t, validProfile()))
	if rec.Code != http.StatusOK {
		t.Fatalf("create for existing account: status=%d body=%s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)

	_, rec = f.do(http.MethodGet, "/v1/me/profile", f.tokenFor(t, adminCreateID), "")
	if rec.Code != http.StatusOK {
		t.Fatalf("owner cannot see the profile created for them: status=%d", rec.Code)
	}

	_, rec = f.do(http.MethodPut, "/v1/admin/users/"+adminMissingID+"/profile", token, encode(t, validProfile()))
	if rec.Code != http.StatusNotFound || problemCode(t, rec) != "user_not_found" {
		t.Fatalf("made-up account: status=%d body=%s", rec.Code, rec.Body.String())
	}
	_, rec = f.do(http.MethodGet, "/v1/admin/users/"+adminMissingID+"/profile", token, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("profile was created for a made-up account: status=%d", rec.Code)
	}

	// Without a directory the existence of the account cannot be checked, so creating is refused.
	unconfigured := newAdminDBFixture(t, nil, nil)
	_, rec = unconfigured.do(http.MethodPut, "/v1/admin/users/"+adminNoAcctID+"/profile", adminToken(unconfigured.fixture), encode(t, validProfile()))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("create without directory: status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAdminReplacesExistingProfileWithoutDirectory(t *testing.T) {
	f := newAdminDBFixture(t, nil, nil)
	createOwnProfile(t, f, adminCreateID, "Анна")
	body := validProfile()
	body["display_name"] = "Анна Петрова"
	req, rec := f.do(http.MethodPut, "/v1/admin/users/"+adminCreateID+"/profile", adminToken(f.fixture), encode(t, body))
	if rec.Code != http.StatusOK {
		t.Fatalf("replace without directory: status=%d body=%s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
	if got := decodeProfile(t, rec); got.DisplayName != "Анна Петрова" {
		t.Fatalf("replacement not stored: %+v", got)
	}
}

func TestAdminValidationReportsEveryViolation(t *testing.T) {
	f := newAdminDBFixture(t, &directoryStub{exists: func(uuid.UUID) (bool, error) { return true, nil }}, nil)
	// Each value passes the contract schema and violates a business rule instead.
	body := validProfile()
	body["birth_year"] = 2015
	body["budget_min_rub"] = 20000
	body["budget_max_rub"] = 15000
	body["city_id"] = 999999
	req, rec := f.do(http.MethodPut, "/v1/admin/users/"+adminMissingID+"/profile", adminToken(f.fixture), encode(t, body))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
	if fields := decodeFieldErrors(t, rec); len(fields) < 2 {
		t.Fatalf("expected every violation at once, got %+v", fields)
	}
}

func TestAdminSearchesAndPagesProfilesByKeyset(t *testing.T) {
	f := newAdminDBFixture(t, nil, nil)
	ids := []string{
		"00000000-0000-0000-0000-000000000001",
		"00000000-0000-0000-0000-000000000002",
		"00000000-0000-0000-0000-000000000003",
	}
	createOwnProfile(t, f, ids[0], "Анна Иванова")
	createOwnProfile(t, f, ids[1], "Борис")
	createOwnProfile(t, f, ids[2], "анна Петрова")
	token := adminToken(f.fixture)

	var page api.AdminProfileList
	req, rec := f.do(http.MethodGet, "/v1/admin/profiles?limit=2", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("first page status=%d body=%s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil || len(page.Items) != 2 || page.NextCursor == nil ||
		page.Items[0].UserId.String() != ids[0] || page.Items[1].UserId.String() != ids[1] {
		t.Fatalf("first page=%+v error=%v", page, err)
	}
	cursor := *page.NextCursor
	_, rec = f.do(http.MethodGet, "/v1/admin/profiles?limit=2&cursor="+cursor, token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("second page status=%d body=%s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil || len(page.Items) != 1 || page.NextCursor != nil ||
		page.Items[0].UserId.String() != ids[2] {
		t.Fatalf("second page=%+v error=%v", page, err)
	}

	_, rec = f.do(http.MethodGet, "/v1/admin/profiles?search=АННА", token, "")
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil || len(page.Items) != 2 {
		t.Fatalf("case-insensitive search returned %+v error=%v", page, err)
	}
	_, rec = f.do(http.MethodGet, "/v1/admin/profiles?search=%25", token, "")
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil || len(page.Items) != 0 {
		t.Fatalf("search must not treat %% as a wildcard: %+v error=%v", page, err)
	}
	_, rec = f.do(http.MethodGet, "/v1/admin/profiles?search="+ids[1], token, "")
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil || len(page.Items) != 1 || page.Items[0].DisplayName != "Борис" {
		t.Fatalf("search by identifier returned %+v error=%v", page, err)
	}
	_, rec = f.do(http.MethodGet, "/v1/admin/profiles?search=борис&cursor="+cursor, token, "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("cursor from another search was accepted: status=%d", rec.Code)
	}
}

func TestAdminDeletesProfileWithoutTouchingTheAccount(t *testing.T) {
	f := newAdminDBFixture(t, nil, nil)
	createOwnProfile(t, f, adminCreateID, "Тестовая")
	token := adminToken(f.fixture)

	req, rec := f.do(http.MethodDelete, "/v1/admin/users/"+adminCreateID+"/profile", token, "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete status=%d body=%s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)

	_, rec = f.do(http.MethodGet, "/v1/me/profile", f.tokenFor(t, adminCreateID), "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("owner still sees the deleted profile: status=%d", rec.Code)
	}
	_, rec = f.do(http.MethodDelete, "/v1/admin/users/"+adminCreateID+"/profile", token, "")
	if rec.Code != http.StatusNotFound || problemCode(t, rec) != "profile_not_found" {
		t.Fatalf("second delete: status=%d body=%s", rec.Code, rec.Body.String())
	}

	// The deletion marker is what removes the candidate from Matching.
	var marks int
	if err := f.pool.QueryRow(t.Context(),
		"SELECT count(*) FROM profile_deletion WHERE user_id = $1", uuid.MustParse(adminCreateID)).Scan(&marks); err != nil {
		t.Fatal(err)
	}
	if marks != 1 {
		t.Fatalf("deletion markers=%d, want 1", marks)
	}
}

func TestAdminReadsAnyProfileAndListsAccountsWithProfileFlag(t *testing.T) {
	var audit bytes.Buffer
	directory := &directoryStub{list: func(int, int, string) (adminusers.Page, error) {
		return adminusers.Page{Total: 2, Users: []adminusers.User{
			{ID: uuid.MustParse(adminCreateID), Username: "with-profile"},
			{ID: uuid.MustParse(adminMissingID), Username: "without-profile"},
		}}, nil
	}}
	f := newAdminDBFixture(t, directory, slog.New(slog.NewTextHandler(&audit, nil)))
	createOwnProfile(t, f, adminCreateID, "Секретное имя")
	token := adminToken(f.fixture)

	_, rec := f.do(http.MethodGet, "/v1/admin/users/"+adminCreateID+"/profile", token, "")
	if rec.Code != http.StatusOK || decodeProfile(t, rec).DisplayName != "Секретное имя" {
		t.Fatalf("admin read: status=%d body=%s", rec.Code, rec.Body.String())
	}

	body := validProfile()
	body["display_name"] = "Новое имя"
	_, rec = f.do(http.MethodPut, "/v1/admin/users/"+adminCreateID+"/profile", token, encode(t, body))
	if rec.Code != http.StatusOK {
		t.Fatalf("admin update: status=%d body=%s", rec.Code, rec.Body.String())
	}
	_, rec = f.do(http.MethodGet, "/v1/me/profile", f.tokenFor(t, adminCreateID), "")
	if decodeProfile(t, rec).DisplayName != "Новое имя" {
		t.Fatal("owner does not see the administrator's change")
	}

	req, rec := f.do(http.MethodGet, "/v1/admin/users?limit=2", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("users status=%d body=%s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
	var users api.AdminUserList
	if err := json.Unmarshal(rec.Body.Bytes(), &users); err != nil || len(users.Items) != 2 ||
		!users.Items[0].HasProfile || users.Items[1].HasProfile {
		t.Fatalf("has_profile flags wrong: %+v error=%v", users, err)
	}

	// The audit record names the operation and the user, never the profile values.
	log := audit.String()
	if !bytes.Contains([]byte(log), []byte("admin profile change")) || !bytes.Contains([]byte(log), []byte(adminCreateID)) ||
		!bytes.Contains([]byte(log), []byte("action=update")) {
		t.Fatalf("audit entry missing: %s", log)
	}
	if bytes.Contains([]byte(log), []byte("Новое имя")) || bytes.Contains([]byte(log), []byte("Секретное")) {
		t.Fatalf("audit entry contains profile values: %s", log)
	}
}

//go:build integration

package api_test

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"sozhiteli.internal/platform/openapi/openapitest"
	"sozhiteli.internal/profile/internal/adminusers"
	"sozhiteli.internal/profile/internal/api"
)

// The account list joins the identity provider with profile_db, so the test
// needs a real database; it moved here from the unit tests for that reason.
func TestAdminUsersIncludeAccountsWithoutProfileAndBindCursorToSearch(t *testing.T) {
	directory := &directoryStub{list: func(first, limit int, search string) (adminusers.Page, error) {
		if search != "alice" || limit != 1 || (first != 0 && first != 1) {
			t.Errorf("unexpected directory request first=%d limit=%d search=%q", first, limit, search)
		}
		created := time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
		return adminusers.Page{Total: 2, Users: []adminusers.User{{ID: uuid.MustParse(userID), Username: "alice", Email: "alice@example.test", Enabled: true, CreatedAt: &created}}}, nil
	}}
	f := newAdminDBFixture(t, directory, nil)
	token := adminToken(f.fixture)
	_, rejected := f.do(http.MethodGet, "/v1/admin/users", f.token, "")
	if rejected.Code != http.StatusForbidden || directory.calls != 0 {
		t.Fatal("ordinary user reached identity directory")
	}
	req, rec := f.do(http.MethodGet, "/v1/admin/users?limit=1&search=alice", token, "")
	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
	var page api.AdminUserList
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil || page.Total != 2 || len(page.Items) != 1 || page.NextCursor == nil {
		t.Fatalf("first page=%+v error=%v", page, err)
	}
	if page.Items[0].HasProfile {
		t.Fatal("account without a profile reported as having one")
	}
	_, rec = f.do(http.MethodGet, "/v1/admin/users?limit=1&search=bob&cursor="+*page.NextCursor, token, "")
	if rec.Code != http.StatusBadRequest || directory.calls != 1 {
		t.Fatal("cursor for another search reached identity directory")
	}
	req, rec = f.do(http.MethodGet, "/v1/admin/users?limit=1&search=alice&cursor="+*page.NextCursor, token, "")
	if rec.Code != http.StatusOK || directory.calls != 2 {
		t.Fatalf("second page status=%d body=%s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil || page.NextCursor != nil {
		t.Fatalf("last page=%+v error=%v", page, err)
	}
}

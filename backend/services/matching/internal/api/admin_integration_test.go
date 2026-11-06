//go:build integration

package api_test

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"

	"sozhiteli.internal/matching/internal/api"
	"sozhiteli.internal/platform/auth/authtest"
	"sozhiteli.internal/platform/openapi/openapitest"
)

func expect(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, status, rec.Body.String())
	}
	if code != "" && problemCode(t, rec) != code {
		t.Fatalf("code = %q, want %q", problemCode(t, rec), code)
	}
}

func TestAdminMatchingDatabaseAndKeysetPages(t *testing.T) {
	f := newDBFixture(t)
	admin := f.issuer.Mint(authtest.Token{Subject: userID, Audience: audience, Roles: []string{"sozhiteli-admin"}})
	first := newCandidate("Первый")
	first.id = uuid.MustParse("00000000-0000-0000-0000-000000000001")
	second := newCandidate("Второй")
	second.id = uuid.MustParse("00000000-0000-0000-0000-000000000002")
	f.insert(t, first)
	f.insert(t, second)
	if _, err := f.pool.Exec(context.Background(), `
INSERT INTO candidate_view (viewer_id, candidate_id, matched_count, compared_count)
VALUES ($1, $2, 2, 3), ($2, $1, 1, 3);
`, first.id, second.id); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(context.Background(), `INSERT INTO sync_state (source) VALUES ('secondary')`); err != nil {
		t.Fatal(err)
	}

	req, rec := f.doAs(admin, http.MethodGet, "/v1/admin/database", "")
	expect(t, rec, http.StatusOK, "")
	openapitest.AssertResponse(t, f.spec, req, rec)
	database := decode[api.AdminDatabase](t, rec)
	if database.Service != "matching" || database.Database == "" || database.SizeBytes <= 0 || len(database.Tables) != 3 {
		t.Fatalf("database = %+v", database)
	}
	for _, table := range database.Tables {
		if table.RowCount != 2 {
			t.Errorf("%s count = %d, want 2", table.Name, table.RowCount)
		}
	}

	var candidateCursor string
	for _, table := range []string{"candidate", "candidate_view", "sync_state"} {
		req, rec := f.doAs(admin, http.MethodGet, "/v1/admin/tables/"+table+"?limit=1", "")
		expect(t, rec, http.StatusOK, "")
		openapitest.AssertResponse(t, f.spec, req, rec)
		page := decode[api.AdminTableRows](t, rec)
		if page.Table != table || len(page.Rows) != 1 || page.NextCursor == nil || len(page.Columns) != len(page.Rows[0]) {
			t.Fatalf("first %s page = %+v", table, page)
		}
		if table == "candidate" {
			candidateCursor = *page.NextCursor
			if page.Rows[0][0] != first.id.String() {
				t.Fatalf("first primary key = %q", page.Rows[0][0])
			}
		}
		req, rec = f.doAs(admin, http.MethodGet, "/v1/admin/tables/"+table+"?limit=1&cursor="+url.QueryEscape(*page.NextCursor), "")
		expect(t, rec, http.StatusOK, "")
		openapitest.AssertResponse(t, f.spec, req, rec)
		last := decode[api.AdminTableRows](t, rec)
		if len(last.Rows) != 1 || last.NextCursor != nil || last.Rows[0][0] == page.Rows[0][0] {
			t.Fatalf("last %s page = %+v", table, last)
		}
	}

	_, rec = f.doAs(f.token, http.MethodGet, "/v1/admin/tables/candidate", "")
	expect(t, rec, http.StatusForbidden, "forbidden")
	_, rec = f.doAs(admin, http.MethodGet, "/v1/admin/tables/profile", "")
	expect(t, rec, http.StatusNotFound, "admin_table_not_found")
	_, rec = f.doAs(admin, http.MethodGet, "/v1/admin/tables/candidate_view?cursor="+url.QueryEscape(candidateCursor), "")
	expect(t, rec, http.StatusBadRequest, "invalid_request")
	raw, err := base64.RawURLEncoding.DecodeString(candidateCursor)
	if err != nil {
		t.Fatal(err)
	}
	foreignCursor := base64.RawURLEncoding.EncodeToString([]byte(strings.Replace(string(raw), "matching", "interaction", 1)))
	_, rec = f.doAs(admin, http.MethodGet, "/v1/admin/tables/candidate?cursor="+url.QueryEscape(foreignCursor), "")
	expect(t, rec, http.StatusBadRequest, "invalid_request")
}

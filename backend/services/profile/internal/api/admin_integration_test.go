//go:build integration

package api_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"sozhiteli.internal/platform/openapi/openapitest"
	"sozhiteli.internal/profile/internal/api"
)

func TestAdminDatabaseAndStaticTablesUseKeysetPagination(t *testing.T) {
	f := newDBFixture(t)
	ids := []string{
		"00000000-0000-0000-0000-000000000001",
		"00000000-0000-0000-0000-000000000002",
		"00000000-0000-0000-0000-000000000003",
	}
	for _, id := range ids {
		_, rec := f.do(http.MethodPut, "/v1/me/profile", f.tokenFor(t, id), encode(t, validProfile()))
		if rec.Code != http.StatusOK {
			t.Fatalf("create profile status=%d body=%s", rec.Code, rec.Body.String())
		}
	}
	if _, err := f.pool.Exec(t.Context(), "DELETE FROM profile WHERE user_id = $1", uuid.MustParse(ids[2])); err != nil {
		t.Fatal(err)
	}
	token := adminToken(f.fixture)
	req, rec := f.do(http.MethodGet, "/v1/admin/database", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("summary status=%d body=%s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
	var summary api.AdminDatabase
	if err := json.Unmarshal(rec.Body.Bytes(), &summary); err != nil {
		t.Fatal(err)
	}
	if summary.Service != "profile" || summary.Database == "" || summary.SizeBytes <= 0 || len(summary.Tables) != 3 {
		t.Fatalf("unexpected database summary: %+v", summary)
	}
	wantCounts := map[string]int64{"profile": 2, "profile_deletion": 1, "city": 1117}
	for _, table := range summary.Tables {
		want, ok := wantCounts[table.Name]
		if !ok || table.RowCount != want || len(table.Columns) == 0 {
			t.Errorf("unexpected table summary: %+v", table)
		}
	}

	req, rec = f.do(http.MethodGet, "/v1/admin/tables/profile?limit=1", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("first profile page status=%d body=%s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
	var page api.AdminTableRows
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil || len(page.Rows) != 1 || len(page.Rows[0]) != len(page.Columns) || page.Rows[0][0] != ids[0] || page.NextCursor == nil {
		t.Fatalf("first profile page=%+v error=%v", page, err)
	}
	firstCursor := *page.NextCursor
	_, rec = f.do(http.MethodGet, "/v1/admin/tables/city?limit=1&cursor="+firstCursor, token, "")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("cross-table cursor status=%d", rec.Code)
	}
	req, rec = f.do(http.MethodGet, "/v1/admin/tables/profile?limit=1&cursor="+firstCursor, token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("second profile page status=%d body=%s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil || len(page.Rows) != 1 || page.Rows[0][0] != ids[1] || page.NextCursor != nil {
		t.Fatalf("second profile page=%+v error=%v", page, err)
	}
	req, rec = f.do(http.MethodGet, "/v1/admin/tables/profile_deletion?limit=1", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("deletions status=%d body=%s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil || len(page.Rows) != 1 || page.Rows[0][0] != ids[2] || len(page.Columns) != 3 || page.NextCursor != nil {
		t.Fatalf("deletion page=%+v error=%v", page, err)
	}

	for expected := 1; expected <= 3; expected++ {
		target := "/v1/admin/tables/city?limit=1"
		if page.Table == "city" && page.NextCursor != nil {
			target += "&cursor=" + *page.NextCursor
		}
		req, rec = f.do(http.MethodGet, target, token, "")
		if rec.Code != http.StatusOK {
			t.Fatalf("cities status=%d body=%s", rec.Code, rec.Body.String())
		}
		openapitest.AssertResponse(t, f.spec, req, rec)
		if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil || len(page.Rows) != 1 || len(page.Columns) != 3 || page.NextCursor == nil {
			t.Fatalf("city page=%+v error=%v", page, err)
		}
		if got := page.Rows[0][0]; got != []string{"1", "2", "3"}[expected-1] {
			t.Errorf("city key=%s at page %d", got, expected)
		}
	}
}

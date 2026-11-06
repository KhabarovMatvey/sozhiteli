//go:build integration

package api_test

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"testing"

	"sozhiteli.internal/interaction/internal/api"
	"sozhiteli.internal/platform/auth/authtest"
	"sozhiteli.internal/platform/openapi/openapitest"
)

func TestAdminInteractionPagesKeepContactsPrivate(t *testing.T) {
	f := newDBFixture(t, 20)
	admin := f.issuer.Mint(authtest.Token{Subject: userID, Audience: audience, Roles: []string{"sozhiteli-admin"}})
	a := f.withContact(t, "private_handle_alpha")
	b := f.withContact(t, "private_handle_beta")
	c := f.person(t)
	f.send(t, a, b)
	f.send(t, b, c)

	req, rec := f.doAs(admin, http.MethodGet, "/v1/admin/database", "")
	expect(t, rec, http.StatusOK, "")
	openapitest.AssertResponse(t, f.spec, req, rec)
	database := decode[api.AdminDatabase](t, rec)
	if database.Service != "interaction" || database.Database == "" || database.SizeBytes <= 0 || len(database.Tables) != 2 {
		t.Fatalf("database = %+v", database)
	}
	for _, table := range database.Tables {
		if table.RowCount != 2 || slices.Contains(table.Columns, "value") {
			t.Errorf("table = %+v", table)
		}
	}

	var contactCursor string
	for _, table := range []string{"contact", "contact_request"} {
		req, rec := f.doAs(admin, http.MethodGet, "/v1/admin/tables/"+table+"?limit=1", "")
		expect(t, rec, http.StatusOK, "")
		openapitest.AssertResponse(t, f.spec, req, rec)
		if strings.Contains(rec.Body.String(), "private_handle") || strings.Contains(rec.Body.String(), `"value"`) {
			t.Fatalf("private contact leaked: %s", rec.Body.String())
		}
		page := decode[api.AdminTableRows](t, rec)
		if page.Table != table || len(page.Rows) != 1 || page.NextCursor == nil || len(page.Columns) != len(page.Rows[0]) {
			t.Fatalf("first %s page = %+v", table, page)
		}
		if table == "contact" {
			contactCursor = *page.NextCursor
			if !slices.Equal(page.Columns, []string{"user_id", "kind", "updated_at"}) {
				t.Fatalf("contact columns = %v", page.Columns)
			}
		}
		req, rec = f.doAs(admin, http.MethodGet, "/v1/admin/tables/"+table+"?limit=1&cursor="+url.QueryEscape(*page.NextCursor), "")
		expect(t, rec, http.StatusOK, "")
		openapitest.AssertResponse(t, f.spec, req, rec)
		last := decode[api.AdminTableRows](t, rec)
		if len(last.Rows) != 1 || last.NextCursor != nil || last.Rows[0][0] <= page.Rows[0][0] {
			t.Fatalf("last %s page = %+v", table, last)
		}
		if strings.Contains(rec.Body.String(), "private_handle") {
			t.Fatal("private contact leaked on second page")
		}
	}

	_, rec = f.doAs(f.token, http.MethodGet, "/v1/admin/tables/contact", "")
	expect(t, rec, http.StatusForbidden, "forbidden")
	_, rec = f.doAs(admin, http.MethodGet, "/v1/admin/tables/candidate", "")
	expect(t, rec, http.StatusNotFound, "admin_table_not_found")
	_, rec = f.doAs(admin, http.MethodGet, "/v1/admin/tables/contact_request?cursor="+url.QueryEscape(contactCursor), "")
	expect(t, rec, http.StatusBadRequest, "invalid_request")
	raw, err := base64.RawURLEncoding.DecodeString(contactCursor)
	if err != nil {
		t.Fatal(err)
	}
	foreignCursor := base64.RawURLEncoding.EncodeToString([]byte(strings.Replace(string(raw), "interaction", "matching", 1)))
	_, rec = f.doAs(admin, http.MethodGet, "/v1/admin/tables/contact?cursor="+url.QueryEscape(foreignCursor), "")
	expect(t, rec, http.StatusBadRequest, "invalid_request")

	// Exercise a valid but empty page and keep the JSON rows an array.
	if _, err := f.pool.Exec(context.Background(), `DELETE FROM contact_request`); err != nil {
		t.Fatal(err)
	}
	_, rec = f.doAs(admin, http.MethodGet, "/v1/admin/tables/contact_request", "")
	expect(t, rec, http.StatusOK, "")
	if rows := decode[api.AdminTableRows](t, rec); rows.Rows == nil || len(rows.Rows) != 0 || rows.NextCursor != nil {
		t.Fatalf("empty page = %+v", rows)
	}
}

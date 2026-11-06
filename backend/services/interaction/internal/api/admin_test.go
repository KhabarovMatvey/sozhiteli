package api_test

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"sozhiteli.internal/interaction/internal/api"
	"sozhiteli.internal/platform/auth"
	"sozhiteli.internal/platform/auth/authtest"
	"sozhiteli.internal/platform/openapi/openapitest"
	"sozhiteli.internal/platform/problem"
)

// Nil database dependencies make it impossible to accidentally pass these
// tests if an endpoint touches data before it authenticates and checks roles.
func TestAdminOperationsRejectBeforeDatabase(t *testing.T) {
	server := api.NewServer(nil, 20)
	cases := []struct {
		name      string
		principal *auth.Principal
		status    int
	}{
		{name: "no principal", status: http.StatusUnauthorized},
		{name: "user without role", principal: &auth.Principal{Subject: userID}, status: http.StatusForbidden},
		{name: "unrelated role", principal: &auth.Principal{Subject: userID, Roles: []string{"admin"}}, status: http.StatusForbidden},
		{name: "invalid user subject", principal: &auth.Principal{Subject: "service-account", Roles: []string{"sozhiteli-admin"}}, status: http.StatusUnauthorized},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			if tc.principal != nil {
				ctx = auth.WithPrincipal(ctx, *tc.principal)
			}
			_, databaseErr := server.GetAdminDatabase(ctx, api.GetAdminDatabaseRequestObject{})
			_, rowsErr := server.ListAdminTableRows(ctx, api.ListAdminTableRowsRequestObject{Table: "unknown"})
			for _, err := range []error{databaseErr, rowsErr} {
				var p *problem.Error
				if !errors.As(err, &p) || p.Status != tc.status {
					t.Fatalf("error = %v, want status %d", err, tc.status)
				}
			}
		})
	}
}

func TestAdminHTTPAuthorizationAndLimits(t *testing.T) {
	f := newFixture(t, nil, 20)
	admin := f.issuer.Mint(authtest.Token{Subject: userID, Audience: audience, Roles: []string{"sozhiteli-admin"}})
	for _, path := range []string{"/v1/admin/database", "/v1/admin/tables/unknown"} {
		for _, tc := range []struct {
			token  string
			status int
		}{{"", 401}, {f.token, 403}} {
			req, rec := f.doAs(tc.token, http.MethodGet, path, "")
			if rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("admin response must prevent caching")
			}
			if rec.Code != tc.status {
				t.Fatalf("%s status = %d, want %d; %s", path, rec.Code, tc.status, rec.Body.String())
			}
			openapitest.AssertResponse(t, f.spec, req, rec)
		}
	}
	for _, query := range []string{"limit=0", "limit=51", "limit=many", "cursor=not-a-cursor"} {
		req, rec := f.doAs(admin, http.MethodGet, "/v1/admin/tables/contact?"+query, "")
		if rec.Code != 400 {
			t.Fatalf("%s status = %d; %s", query, rec.Code, rec.Body.String())
		}
		openapitest.AssertResponse(t, f.spec, req, rec)
	}
}

package api_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"sozhiteli.internal/platform/auth"
	"sozhiteli.internal/platform/auth/authtest"
	"sozhiteli.internal/platform/openapi/openapitest"
	"sozhiteli.internal/profile/internal/adminusers"
	"sozhiteli.internal/profile/internal/api"
)

func adminToken(f fixture) string {
	return f.issuer.Mint(authtest.Token{Subject: userID, Audience: audience, Roles: []string{api.AdminRole}, ClientID: "sozhiteli-web"})
}

func TestAdminOperationsRejectOrdinaryUsersBeforeDataAccess(t *testing.T) {
	f := newFixture(t, nil)
	for _, target := range []string{"/v1/admin/database", "/v1/admin/users", "/v1/admin/tables/profile", "/v1/admin/tables/city", "/v1/admin/tables/profile_deletion"} {
		t.Run(target, func(t *testing.T) {
			req, rec := f.do(http.MethodGet, target, f.token, "")
			if rec.Code != http.StatusForbidden || problemCode(t, rec) != "forbidden" {
				t.Fatalf("ordinary user status=%d body=%s", rec.Code, rec.Body.String())
			}
			openapitest.AssertResponse(t, f.spec, req, rec)
			_, anonymous := f.do(http.MethodGet, target, "", "")
			if anonymous.Code != http.StatusUnauthorized {
				t.Errorf("anonymous status=%d", anonymous.Code)
			}
		})
	}
}

func TestAdminValidationRejectsBadPaginationBeforeDatabase(t *testing.T) {
	f := newFixture(t, nil)
	token := adminToken(f)
	for _, target := range []string{
		"/v1/admin/tables/profile?limit=0", "/v1/admin/tables/profile?limit=51",
		"/v1/admin/tables/profile?cursor=invalid", "/v1/admin/tables/keycloak",
		"/v1/admin/users?limit=51", "/v1/admin/users?cursor=invalid", "/v1/admin/users?search=" + strings.Repeat("a", 129),
	} {
		t.Run(target, func(t *testing.T) {
			req, rec := f.do(http.MethodGet, target, token, "")
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("invalid pagination status=%d body=%s", rec.Code, rec.Body.String())
			}
			openapitest.AssertResponse(t, f.spec, req, rec)
		})
	}
}

func TestUnconfiguredAdminDirectoryDoesNotAffectOrdinaryOperations(t *testing.T) {
	f := newFixture(t, nil)
	req, rec := f.do(http.MethodGet, "/v1/admin/users", adminToken(f), "")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured users status=%d body=%s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
	_, rec = f.do(http.MethodGet, "/v1/questionnaire", f.token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("ordinary questionnaire status=%d", rec.Code)
	}
}

type directoryStub struct {
	calls  int
	list   func(int, int, string) (adminusers.Page, error)
	exists func(uuid.UUID) (bool, error)
}

func (d *directoryStub) List(_ context.Context, first, limit int, search string) (adminusers.Page, error) {
	d.calls++
	return d.list(first, limit, search)
}

func (d *directoryStub) Exists(_ context.Context, id uuid.UUID) (bool, error) {
	if d.exists == nil {
		return false, errors.New("unexpected directory lookup")
	}
	return d.exists(id)
}

func withDirectory(t *testing.T, f fixture, directory api.AdminUserDirectory) fixture {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler, err := api.NewHandler(logger, auth.NewVerifier(f.issuer.Config(audience)), api.NewServer(nil).WithAdminUsers(directory))
	if err != nil {
		t.Fatal(err)
	}
	f.handler = handler
	return f
}

func TestAdminDirectoryFailuresDoNotExposeUpstreamDetails(t *testing.T) {
	directory := &directoryStub{list: func(_, _ int, _ string) (adminusers.Page, error) {
		return adminusers.Page{}, errors.New("private-client-secret private-email upstream-host")
	}}
	f := withDirectory(t, newFixture(t, nil), directory)
	req, rec := f.do(http.MethodGet, "/v1/admin/users", adminToken(f), "")
	if rec.Code != http.StatusServiceUnavailable || strings.Contains(rec.Body.String(), "private") || strings.Contains(rec.Body.String(), "upstream-host") {
		t.Fatalf("upstream error escaped: status=%d body=%s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
}

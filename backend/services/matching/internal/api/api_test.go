package api_test

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"

	"sozhiteli.internal/matching/internal/api"
	"sozhiteli.internal/matching/internal/store"
	"sozhiteli.internal/platform/auth"
	"sozhiteli.internal/platform/auth/authtest"
	"sozhiteli.internal/platform/openapi"
	"sozhiteli.internal/platform/openapi/openapitest"
)

const (
	audience = "sozhiteli-api"
	userID   = "7d2c1f6e-3b0a-4c58-9a51-0c2a7f1e9b11"
)

type fixture struct {
	handler http.Handler
	spec    *openapi3.T
	issuer  *authtest.Issuer
	token   string
}

// newFixture builds the API handler. Tests that never reach an operation
// touching the database pass nil queries; integration tests pass a store.
func newFixture(t *testing.T, queries *store.Queries) fixture {
	t.Helper()

	issuer := authtest.NewIssuer(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler, err := api.NewHandler(logger, auth.NewVerifier(issuer.Config(audience)), api.NewServer(queries))
	if err != nil {
		t.Fatalf("NewHandler: %v", err)
	}

	spec, err := api.GetSpec()
	if err != nil {
		t.Fatalf("GetSpec: %v", err)
	}
	if err := openapi.Prepare(context.Background(), spec); err != nil {
		t.Fatalf("contract is invalid: %v", err)
	}
	return fixture{handler: handler, spec: spec, issuer: issuer, token: issuer.UserToken(userID, audience)}
}

func (f fixture) do(method, url, body string) (*http.Request, *httptest.ResponseRecorder) {
	return f.doAs(f.token, method, url, body)
}

func (f fixture) doAs(token, method, url, body string) (*http.Request, *httptest.ResponseRecorder) {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, url, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	return req, rec
}

func TestEveryOperationRequiresAuthentication(t *testing.T) {
	f := newFixture(t, nil)
	openapitest.CheckAuthenticationRequired(t, f.spec, f.handler)
}

func TestRequestsAreValidatedAgainstContract(t *testing.T) {
	f := newFixture(t, nil)

	cases := map[string][3]string{
		"limit above maximum":   {http.MethodGet, "/v1/candidates?limit=51", ""},
		"limit is not a number": {http.MethodGet, "/v1/candidates?limit=many", ""},
		"path id is not a uuid": {http.MethodGet, "/v1/candidates/42", ""},
		"lookup without ids":    {http.MethodPost, "/v1/candidates/lookup", `{}`},
		"lookup with empty ids": {http.MethodPost, "/v1/candidates/lookup", `{"user_ids":[]}`},
		"lookup with bad id":    {http.MethodPost, "/v1/candidates/lookup", `{"user_ids":["nope"]}`},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			req, rec := f.do(tc[0], tc[1], tc[2])

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body: %s", rec.Code, rec.Body.String())
			}
			openapitest.AssertResponse(t, f.spec, req, rec)
		})
	}
}

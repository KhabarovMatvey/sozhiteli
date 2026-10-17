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
	"github.com/jackc/pgx/v5/pgxpool"

	"sozhiteli.internal/interaction/internal/api"
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
// touching the database pass a nil pool; integration tests pass a real one.
func newFixture(t *testing.T, pool *pgxpool.Pool, dailyLimit int) fixture {
	t.Helper()

	issuer := authtest.NewIssuer(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler, err := api.NewHandler(logger, auth.NewVerifier(issuer.Config(audience)), api.NewServer(pool, dailyLimit))
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
	f := newFixture(t, nil, 20)
	openapitest.CheckAuthenticationRequired(t, f.spec, f.handler)
}

func TestRequestsAreValidatedAgainstContract(t *testing.T) {
	f := newFixture(t, nil, 20)

	cases := map[string][3]string{
		"list without direction":    {http.MethodGet, "/v1/contact-requests", ""},
		"list with bad direction":   {http.MethodGet, "/v1/contact-requests?direction=sideways", ""},
		"list with bad counterpart": {http.MethodGet, "/v1/contact-requests?direction=incoming&counterpart_id=42", ""},
		"create without recipient":  {http.MethodPost, "/v1/contact-requests", `{}`},
		"create with bad recipient": {http.MethodPost, "/v1/contact-requests", `{"recipient_id":"nope"}`},
		"contact with unknown kind": {http.MethodPut, "/v1/me/contact", `{"kind":"phone","value":"79990000000"}`},
		"contact value too long":    {http.MethodPut, "/v1/me/contact", `{"kind":"telegram","value":"` + strings.Repeat("a", 65) + `"}`},
		"accept with bad id":        {http.MethodPost, "/v1/contact-requests/42/accept", ""},
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

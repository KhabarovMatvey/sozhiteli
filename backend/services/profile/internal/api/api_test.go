package api_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"

	"sozhiteli.internal/platform/auth"
	"sozhiteli.internal/platform/auth/authtest"
	"sozhiteli.internal/platform/openapi"
	"sozhiteli.internal/platform/openapi/openapitest"
	"sozhiteli.internal/profile/internal/api"
	"sozhiteli.internal/profile/internal/store"
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
// touching the database (authentication, schema validation) pass nil queries;
// integration tests pass a real store.
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

func (f fixture) do(method, url, token, body string) (*http.Request, *httptest.ResponseRecorder) {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, url, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	return req, rec
}

func problemCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var doc struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("response is not a problem document: %v; body: %s", err, rec.Body.String())
	}
	return doc.Code
}

func TestEveryOperationRequiresAuthentication(t *testing.T) {
	f := newFixture(t, nil)
	openapitest.CheckAuthenticationRequired(t, f.spec, f.handler)
}

func TestRequestBodyIsValidatedAgainstContract(t *testing.T) {
	f := newFixture(t, nil)

	cases := map[string]string{
		"empty object":   `{}`,
		"not json":       `{"display_name":`,
		"field too long": `{"display_name":"` + strings.Repeat("a", 41) + `"}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			req, rec := f.do(http.MethodPut, "/v1/me/profile", f.token, body)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body: %s", rec.Code, rec.Body.String())
			}
			if code := problemCode(t, rec); code != "invalid_request" {
				t.Errorf("code = %q", code)
			}
			openapitest.AssertResponse(t, f.spec, req, rec)
		})
	}
}

func TestGetQuestionnaire(t *testing.T) {
	f := newFixture(t, nil)

	req, rec := f.do(http.MethodGet, "/v1/questionnaire", f.token, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body: %s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)

	var got api.Questionnaire
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Version != 2 || len(got.Questions) != 11 {
		t.Errorf("unexpected questionnaire: version %d, %d questions", got.Version, len(got.Questions))
	}
}

func TestUnknownPathUsesProblemFormat(t *testing.T) {
	f := newFixture(t, nil)

	_, rec := f.do(http.MethodGet, "/v1/does-not-exist", f.token, "")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/problem+json" {
		t.Errorf("Content-Type = %q", got)
	}
}

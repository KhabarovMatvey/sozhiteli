package auth_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"sozhiteli.internal/platform/auth"
	"sozhiteli.internal/platform/auth/authtest"
)

const (
	audience = "sozhiteli-api"
	subject  = "7d2c1f6e-3b0a-4c58-9a51-0c2a7f1e9b11"
)

func protected(v *auth.Verifier, mws ...func(http.Handler) http.Handler) http.Handler {
	var h http.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, _ := auth.PrincipalFrom(r.Context())
		w.Header().Set("X-Subject", p.Subject)
		w.WriteHeader(http.StatusNoContent)
	})
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return v.Middleware()(h)
}

func call(h http.Handler, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestMiddlewareAcceptsValidToken(t *testing.T) {
	issuer := authtest.NewIssuer(t)
	h := protected(auth.NewVerifier(issuer.Config(audience)))

	rec := call(h, issuer.UserToken(subject, audience))

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d", rec.Code)
	}
	if got := rec.Header().Get("X-Subject"); got != subject {
		t.Errorf("subject = %q", got)
	}
}

func TestMiddlewareRejectsInvalidTokens(t *testing.T) {
	issuer := authtest.NewIssuer(t)
	other := authtest.NewIssuer(t)
	h := protected(auth.NewVerifier(issuer.Config(audience)))

	cases := map[string]string{
		"no token":       "",
		"garbage":        "not-a-jwt",
		"wrong audience": issuer.UserToken(subject, "sozhiteli-internal"),
		"expired":        issuer.Mint(authtest.Token{Subject: subject, Audience: audience, ExpiresIn: -time.Minute}),
		"wrong issuer":   issuer.Mint(authtest.Token{Subject: subject, Audience: audience, Issuer: "https://evil.example"}),
		"foreign key":    other.Mint(authtest.Token{Subject: subject, Audience: audience, Issuer: issuer.URL}),
		"no subject":     issuer.Mint(authtest.Token{Audience: audience}),
	}
	for name, token := range cases {
		t.Run(name, func(t *testing.T) {
			rec := call(h, token)

			if rec.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want 401", rec.Code)
			}
			if got := rec.Header().Get("Content-Type"); got != "application/problem+json" {
				t.Errorf("Content-Type = %q", got)
			}
			if rec.Header().Get("WWW-Authenticate") == "" {
				t.Error("WWW-Authenticate is not set")
			}
		})
	}
}

func TestRequireRole(t *testing.T) {
	const role = "internal.profile-changes.read"
	issuer := authtest.NewIssuer(t)
	h := protected(auth.NewVerifier(issuer.Config(audience)), auth.RequireRole(role))

	withRole := issuer.Mint(authtest.Token{Subject: subject, Audience: audience, Roles: []string{role}})
	if rec := call(h, withRole); rec.Code != http.StatusNoContent {
		t.Errorf("with role: status = %d", rec.Code)
	}

	withoutRole := issuer.UserToken(subject, audience)
	if rec := call(h, withoutRole); rec.Code != http.StatusForbidden {
		t.Errorf("without role: status = %d, want 403", rec.Code)
	}
}

// Package authtest is a TEST-ONLY stand-in for the identity provider. It
// serves a JWKS document and mints tokens signed with a throwaway key, so
// tests exercise the real verification path without Keycloak.
//
// It must never be imported from non-test code.
package authtest

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"

	"sozhiteli.internal/platform/auth"
)

const keyID = "authtest-key"

// Issuer is a fake identity provider bound to one test.
type Issuer struct {
	// URL is both the issuer identifier and the base of the JWKS endpoint.
	URL    string
	signer jose.Signer
	t      testing.TB
}

// NewIssuer starts a fake identity provider that lives until the test ends.
func NewIssuer(t testing.TB) *Issuer {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate test key: %v", err)
	}
	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.RS256, Key: jose.JSONWebKey{Key: key, KeyID: keyID}},
		(&jose.SignerOptions{}).WithType("JWT"),
	)
	if err != nil {
		t.Fatalf("create test signer: %v", err)
	}

	jwks := jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
		{Key: &key.PublicKey, KeyID: keyID, Algorithm: string(jose.RS256), Use: "sig"},
	}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /jwks", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(jwks)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	return &Issuer{URL: srv.URL, signer: signer, t: t}
}

// Config returns verifier settings that accept this issuer's tokens for
// audience.
func (i *Issuer) Config(audience string) auth.Config {
	return auth.Config{Issuer: i.URL, JWKSURL: i.URL + "/jwks", Audience: audience}
}

// Token describes a token to mint. Zero values get sensible defaults.
type Token struct {
	Subject  string
	Audience string
	Roles    []string
	ClientID string
	// Issuer overrides the "iss" claim; empty means this issuer.
	Issuer string
	// ExpiresIn overrides the lifetime; zero means five minutes. Negative
	// values produce an already expired token.
	ExpiresIn time.Duration
}

// Mint returns a signed token.
func (i *Issuer) Mint(tok Token) string {
	i.t.Helper()

	issuer := tok.Issuer
	if issuer == "" {
		issuer = i.URL
	}
	lifetime := tok.ExpiresIn
	if lifetime == 0 {
		lifetime = 5 * time.Minute
	}
	now := time.Now()

	claims := map[string]any{
		"iss": issuer,
		"sub": tok.Subject,
		"aud": []string{tok.Audience},
		"iat": now.Add(-time.Minute).Unix(),
		"exp": now.Add(lifetime).Unix(),
		"azp": tok.ClientID,
		"realm_access": map[string]any{
			"roles": tok.Roles,
		},
	}
	raw, err := jwt.Signed(i.signer).Claims(claims).Serialize()
	if err != nil {
		i.t.Fatalf("mint test token: %v", err)
	}
	return raw
}

// UserToken returns a valid end-user token for subject.
func (i *Issuer) UserToken(subject, audience string) string {
	i.t.Helper()
	return i.Mint(Token{Subject: subject, Audience: audience, ClientID: "sozhiteli-web"})
}

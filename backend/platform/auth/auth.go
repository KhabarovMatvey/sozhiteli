// Package auth verifies OIDC access tokens and exposes the caller identity to
// handlers. It contains no cryptography of its own: signature, issuer,
// audience and expiry checks are done by github.com/coreos/go-oidc.
//
// Two kinds of callers exist:
//   - end users: tokens with audience "sozhiteli-api"; Principal.Subject is the
//     user identifier and the only source of "who is asking" in a service;
//   - services: client-credentials tokens with audience "sozhiteli-internal"
//     and realm roles; checked with RequireRole.
package auth

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/google/uuid"

	"sozhiteli.internal/platform/problem"
)

// Config describes how tokens for one audience are verified.
type Config struct {
	// Issuer is the exact value expected in the "iss" claim.
	Issuer string
	// JWKSURL is where the signing keys are fetched from. It is configured
	// separately from Issuer because inside a container network the provider
	// is reached by a different host name than the one in the token.
	JWKSURL string
	// Audience must be present in the "aud" claim.
	Audience string
}

// Principal is the authenticated caller.
type Principal struct {
	// Subject is the "sub" claim: the user identifier for user tokens.
	Subject string
	// ClientID is the "azp" claim: the OIDC client the token was issued to.
	ClientID string
	// Roles are the realm roles granted to the caller.
	Roles []string
}

// HasRole reports whether the caller was granted role.
func (p Principal) HasRole(role string) bool {
	return slices.Contains(p.Roles, role)
}

// Verifier verifies bearer tokens for one audience.
type Verifier struct {
	verifier *oidc.IDTokenVerifier
}

// NewVerifier builds a Verifier. Signing keys are fetched lazily on the first
// request and cached, so a service starts even when the identity provider is
// temporarily unreachable.
func NewVerifier(cfg Config) *Verifier {
	// The key set keeps this context for background key fetches, so it must
	// not be tied to a request or to startup.
	ctx := oidc.ClientContext(context.Background(), &http.Client{Timeout: 5 * time.Second})
	keys := oidc.NewRemoteKeySet(ctx, cfg.JWKSURL)
	return &Verifier{
		verifier: oidc.NewVerifier(cfg.Issuer, keys, &oidc.Config{ClientID: cfg.Audience}),
	}
}

type tokenClaims struct {
	AuthorizedParty string `json:"azp"`
	RealmAccess     struct {
		Roles []string `json:"roles"`
	} `json:"realm_access"`
}

// Verify checks the token signature, issuer, audience and expiry.
func (v *Verifier) Verify(ctx context.Context, rawToken string) (Principal, error) {
	token, err := v.verifier.Verify(ctx, rawToken)
	if err != nil {
		return Principal{}, err
	}
	if token.Subject == "" {
		return Principal{}, errors.New("token has no subject")
	}
	var claims tokenClaims
	if err := token.Claims(&claims); err != nil {
		return Principal{}, err
	}
	return Principal{
		Subject:  token.Subject,
		ClientID: claims.AuthorizedParty,
		Roles:    claims.RealmAccess.Roles,
	}, nil
}

type principalKey struct{}

// WithPrincipal returns a context carrying p. Production code gets the
// principal from Middleware; tests may set it directly.
func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, p)
}

// PrincipalFrom returns the authenticated caller, if any.
func PrincipalFrom(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(principalKey{}).(Principal)
	return p, ok
}

// UserID returns the identifier of the authenticated end user. Handlers call
// it instead of trusting any user identifier sent by the client. It fails with
// a 401 problem when the request is unauthenticated or the subject is not a
// UUID (for example, a service token was used on a user endpoint).
func UserID(ctx context.Context) (uuid.UUID, error) {
	p, ok := PrincipalFrom(ctx)
	if !ok {
		return uuid.Nil, problem.Unauthorized()
	}
	id, err := uuid.Parse(p.Subject)
	if err != nil {
		return uuid.Nil, problem.Unauthorized()
	}
	return id, nil
}

// Middleware rejects requests without a valid bearer token with 401 and puts
// the Principal into the request context for the rest.
func (v *Verifier) Middleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw, ok := bearerToken(r)
			if !ok {
				unauthorized(w, r)
				return
			}
			p, err := v.Verify(r.Context(), raw)
			if err != nil {
				// The reason is deliberately not returned: it would help an
				// attacker probe token validation.
				unauthorized(w, r)
				return
			}
			next.ServeHTTP(w, r.WithContext(WithPrincipal(r.Context(), p)))
		})
	}
}

// RequireRole rejects authenticated callers without role with 403. It must be
// installed after Middleware.
func RequireRole(role string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p, ok := PrincipalFrom(r.Context())
			if !ok {
				unauthorized(w, r)
				return
			}
			if !p.HasRole(role) {
				problem.Write(w, r, problem.Forbidden())
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func unauthorized(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("WWW-Authenticate", "Bearer")
	problem.Write(w, r, problem.Unauthorized())
}

func bearerToken(r *http.Request) (string, bool) {
	scheme, token, found := strings.Cut(r.Header.Get("Authorization"), " ")
	if !found || !strings.EqualFold(scheme, "Bearer") || token == "" {
		return "", false
	}
	return token, true
}

package config

import "time"

// Base is the configuration every service needs. A service embeds it in its
// own Config and adds what only it needs. Variables are documented in
// docs/ENGINEERING_RULES.md and .env.example.
type Base struct {
	// HTTPAddr is the listen address of the public API (HTTP_ADDR).
	HTTPAddr string
	// LogLevel is debug, info, warn or error (LOG_LEVEL).
	LogLevel string

	// RequestTimeout bounds the handling of one request (REQUEST_TIMEOUT).
	RequestTimeout time.Duration
	// ShutdownTimeout is how long in-flight requests may finish after SIGTERM
	// (SHUTDOWN_TIMEOUT).
	ShutdownTimeout time.Duration
	// MaxInFlight is the number of concurrently handled requests after which
	// new ones are shed with 503 (MAX_IN_FLIGHT).
	MaxInFlight int

	// DatabaseURL is the connection string of the service runtime role
	// (DATABASE_URL).
	DatabaseURL string
	// DBMaxConns bounds the connection pool (DB_MAX_CONNS).
	DBMaxConns int
	// DBStatementTimeout aborts long statements (DB_STATEMENT_TIMEOUT).
	DBStatementTimeout time.Duration

	// OIDCIssuer is the expected "iss" claim (OIDC_ISSUER).
	OIDCIssuer string
	// OIDCJWKSURL is where signing keys are fetched (OIDC_JWKS_URL).
	OIDCJWKSURL string
	// OIDCAudience is the audience of end-user tokens (OIDC_AUDIENCE).
	OIDCAudience string
}

// LoadBase reads the common configuration. Problems are recorded in l.
func LoadBase(l *Loader) Base {
	return Base{
		HTTPAddr:           l.String("HTTP_ADDR", ":8080"),
		LogLevel:           l.String("LOG_LEVEL", "info"),
		RequestTimeout:     l.Duration("REQUEST_TIMEOUT", 5*time.Second),
		ShutdownTimeout:    l.Duration("SHUTDOWN_TIMEOUT", 20*time.Second),
		MaxInFlight:        l.Int("MAX_IN_FLIGHT", 256),
		DatabaseURL:        l.RequiredString("DATABASE_URL"),
		DBMaxConns:         l.Int("DB_MAX_CONNS", 10),
		DBStatementTimeout: l.Duration("DB_STATEMENT_TIMEOUT", 3*time.Second),
		OIDCIssuer:         l.RequiredString("OIDC_ISSUER"),
		OIDCJWKSURL:        l.RequiredString("OIDC_JWKS_URL"),
		OIDCAudience:       l.String("OIDC_AUDIENCE", "sozhiteli-api"),
	}
}

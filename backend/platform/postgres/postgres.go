// Package postgres builds the pgx connection pool every service uses to reach
// its OWN database. A service never receives a connection string for another
// service's database.
package postgres

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Config holds pool settings.
type Config struct {
	// URL is the connection string of the service runtime role.
	URL string
	// Application is reported to PostgreSQL as application_name.
	Application string
	// MaxConns bounds the pool. The sum over all replicas of all services must
	// stay below the server max_connections (see README.md, section 9).
	MaxConns int
	// StatementTimeout aborts any single statement that runs longer.
	StatementTimeout time.Duration
}

// NewPool creates the pool without connecting: connections are opened on
// demand, so a service starts while the database is still coming up and
// reports the fact through its readiness endpoint.
func NewPool(ctx context.Context, cfg Config) (*pgxpool.Pool, error) {
	pc, err := pgxpool.ParseConfig(cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}

	pc.MaxConns = int32(cfg.MaxConns)
	pc.MinConns = 0
	pc.MaxConnLifetime = 30 * time.Minute
	pc.MaxConnLifetimeJitter = 5 * time.Minute
	pc.MaxConnIdleTime = 5 * time.Minute
	pc.HealthCheckPeriod = 30 * time.Second

	pc.ConnConfig.ConnectTimeout = 5 * time.Second
	params := pc.ConnConfig.RuntimeParams
	params["application_name"] = cfg.Application
	params["statement_timeout"] = strconv.FormatInt(cfg.StatementTimeout.Milliseconds(), 10)
	// A transaction left open by a bug would otherwise hold locks and, in the
	// Profile database, stall the change feed (ADR-0004 in README.md).
	params["idle_in_transaction_session_timeout"] = strconv.FormatInt((2 * cfg.StatementTimeout).Milliseconds(), 10)

	pool, err := pgxpool.NewWithConfig(ctx, pc)
	if err != nil {
		return nil, fmt.Errorf("create connection pool: %w", err)
	}
	return pool, nil
}

// Check returns a readiness check that pings the database.
func Check(pool *pgxpool.Pool) func(context.Context) error {
	return pool.Ping
}

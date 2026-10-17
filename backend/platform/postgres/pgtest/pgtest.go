// Package pgtest is a TEST-ONLY helper that gives each integration test its
// own empty PostgreSQL database.
//
// Integration tests are compiled only with the build tag `integration` and
// need TEST_DATABASE_URL: a connection string of a role allowed to create
// databases on a disposable server. `npm run backend:test:integration` starts
// such a server and sets the variable.
package pgtest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// NewDatabase creates an empty database, registers its removal for the end of
// the test and returns its connection string.
func NewDatabase(t testing.TB) string {
	t.Helper()

	adminURL := os.Getenv("TEST_DATABASE_URL")
	if adminURL == "" {
		t.Fatal("TEST_DATABASE_URL is not set; run integration tests with `npm run backend:test:integration`")
	}

	var suffix [6]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		t.Fatalf("generate database name: %v", err)
	}
	name := "test_" + hex.EncodeToString(suffix[:])

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	admin, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		t.Fatalf("connect to test server: %v", err)
	}
	defer admin.Close(ctx)

	// The name is generated above from hex digits, so it is safe to inline.
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatalf("create test database: %v", err)
	}

	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		conn, err := pgx.Connect(ctx, adminURL)
		if err != nil {
			t.Logf("drop test database: %v", err)
			return
		}
		defer conn.Close(ctx)
		if _, err := conn.Exec(ctx, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)"); err != nil {
			t.Logf("drop test database: %v", err)
		}
	})

	u, err := url.Parse(adminURL)
	if err != nil {
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
	}
	u.Path = "/" + name
	return u.String()
}

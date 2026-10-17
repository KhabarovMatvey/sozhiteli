// Package migrate applies a service's embedded SQL migrations with goose.
//
// Migrations run as a separate one-shot step (`<service> migrate up`) with a
// dedicated schema-owner role, never at service start: several replicas would
// race, and the runtime role must not be able to change the schema.
package migrate

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"

	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx"
	"github.com/pressly/goose/v3"
)

func provider(databaseURL string, migrations fs.FS) (*goose.Provider, *sql.DB, error) {
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, nil, fmt.Errorf("open database: %w", err)
	}
	p, err := goose.NewProvider(goose.DialectPostgres, db, migrations)
	if err != nil {
		_ = db.Close()
		return nil, nil, fmt.Errorf("load migrations: %w", err)
	}
	return p, db, nil
}

// Up applies every pending migration and returns the resulting schema version.
func Up(ctx context.Context, databaseURL string, migrations fs.FS) (int64, error) {
	p, db, err := provider(databaseURL, migrations)
	if err != nil {
		return 0, err
	}
	defer db.Close()

	if _, err := p.Up(ctx); err != nil {
		return 0, fmt.Errorf("apply migrations: %w", err)
	}
	return p.GetDBVersion(ctx)
}

// DownTo rolls the schema back to version (0 removes everything). It exists
// for tests that prove every migration is reversible; the service binaries do
// not expose it.
func DownTo(ctx context.Context, databaseURL string, migrations fs.FS, version int64) error {
	p, db, err := provider(databaseURL, migrations)
	if err != nil {
		return err
	}
	defer db.Close()

	if _, err := p.DownTo(ctx, version); err != nil {
		return fmt.Errorf("roll back migrations: %w", err)
	}
	return nil
}

// Status describes one migration.
type Status struct {
	Version int64
	Name    string
	Applied bool
}

// List reports which migrations are applied.
func List(ctx context.Context, databaseURL string, migrations fs.FS) ([]Status, error) {
	p, db, err := provider(databaseURL, migrations)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	statuses, err := p.Status(ctx)
	if err != nil {
		return nil, fmt.Errorf("read migration status: %w", err)
	}
	out := make([]Status, 0, len(statuses))
	for _, s := range statuses {
		out = append(out, Status{
			Version: s.Source.Version,
			Name:    s.Source.Path,
			Applied: s.State == goose.StateApplied,
		})
	}
	return out, nil
}

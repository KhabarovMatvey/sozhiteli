//go:build integration

package migrations_test

import (
	"context"
	"testing"

	"sozhiteli.internal/interaction/migrations"
	"sozhiteli.internal/platform/migrate"
	"sozhiteli.internal/platform/postgres/pgtest"
)

// Every migration must apply to an empty database, roll back completely and
// apply again: this proves both directions of every file.
func TestMigrationsApplyAndRollBack(t *testing.T) {
	ctx := context.Background()
	databaseURL := pgtest.NewDatabase(t)

	version, err := migrate.Up(ctx, databaseURL, migrations.FS)
	if err != nil {
		t.Fatalf("up: %v", err)
	}
	if version < 1 {
		t.Fatalf("schema version after up = %d", version)
	}

	if err := migrate.DownTo(ctx, databaseURL, migrations.FS, 0); err != nil {
		t.Fatalf("down: %v", err)
	}

	again, err := migrate.Up(ctx, databaseURL, migrations.FS)
	if err != nil {
		t.Fatalf("second up: %v", err)
	}
	if again != version {
		t.Errorf("schema version after second up = %d, want %d", again, version)
	}

	statuses, err := migrate.List(ctx, databaseURL, migrations.FS)
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	for _, s := range statuses {
		if !s.Applied {
			t.Errorf("migration %d (%s) is not applied", s.Version, s.Name)
		}
	}
}

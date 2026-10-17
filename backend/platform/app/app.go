// Package app is the common entry point of a service binary. Every service
// exposes the same three subcommands:
//
//	<service> serve        run the HTTP server (default)
//	<service> migrate up   apply pending schema migrations and exit
//	<service> migrate status
//	<service> healthcheck  exit 0 when the local instance is ready
package app

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"os"
	"os/signal"
	"syscall"

	"sozhiteli.internal/platform/config"
	"sozhiteli.internal/platform/health"
	"sozhiteli.internal/platform/migrate"
)

// App describes one service binary.
type App struct {
	// Name is the service name used in messages.
	Name string
	// Serve runs the service until ctx is cancelled.
	Serve func(ctx context.Context) error
	// Migrations holds the embedded SQL migrations of the service.
	Migrations fs.FS
}

// Main runs the subcommand named by the process arguments and exits with a
// non-zero status on failure. SIGINT and SIGTERM cancel the context, which
// starts a graceful shutdown.
func (a App) Main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	err := a.run(ctx, os.Args[1:])
	stop()
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s: %v\n", a.Name, err)
		os.Exit(1)
	}
}

func (a App) run(ctx context.Context, args []string) error {
	command := "serve"
	if len(args) > 0 {
		command = args[0]
		args = args[1:]
	}

	switch command {
	case "serve":
		return a.Serve(ctx)
	case "migrate":
		return a.migrate(ctx, args)
	case "healthcheck":
		return a.healthcheck(ctx)
	default:
		return fmt.Errorf("unknown command %q; expected serve, migrate or healthcheck", command)
	}
}

// migrate uses MIGRATE_DATABASE_URL: the connection string of the schema-owner
// role, which the running service never receives.
func (a App) migrate(ctx context.Context, args []string) error {
	loader := config.NewLoader()
	databaseURL := loader.RequiredString("MIGRATE_DATABASE_URL")
	if err := loader.Err(); err != nil {
		return err
	}

	action := "up"
	if len(args) > 0 {
		action = args[0]
	}
	switch action {
	case "up":
		version, err := migrate.Up(ctx, databaseURL, a.Migrations)
		if err != nil {
			return err
		}
		fmt.Printf("%s: schema is at version %d\n", a.Name, version)
		return nil
	case "status":
		statuses, err := migrate.List(ctx, databaseURL, a.Migrations)
		if err != nil {
			return err
		}
		for _, s := range statuses {
			state := "pending"
			if s.Applied {
				state = "applied"
			}
			fmt.Printf("%05d %-8s %s\n", s.Version, state, s.Name)
		}
		return nil
	default:
		return fmt.Errorf("unknown migrate action %q; expected up or status", action)
	}
}

func (a App) healthcheck(ctx context.Context) error {
	addr := config.NewLoader().String("HTTP_ADDR", ":8080")
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return errors.New("HTTP_ADDR must look like :8080")
	}
	return health.Probe(ctx, "http://127.0.0.1:"+port+"/readyz")
}

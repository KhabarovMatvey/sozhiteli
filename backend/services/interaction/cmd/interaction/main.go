// Command interaction runs the Interaction service: the owner of private
// contacts and contact requests. See docs/SERVICE_BOUNDARIES.md.
package main

import (
	"context"
	"os"

	"sozhiteli.internal/interaction/internal/api"
	"sozhiteli.internal/interaction/internal/config"
	"sozhiteli.internal/interaction/migrations"
	"sozhiteli.internal/platform/app"
	"sozhiteli.internal/platform/auth"
	"sozhiteli.internal/platform/health"
	"sozhiteli.internal/platform/httpserver"
	"sozhiteli.internal/platform/logging"
	"sozhiteli.internal/platform/postgres"
)

const serviceName = "interaction"

func main() {
	app.App{Name: serviceName, Serve: serve, Migrations: migrations.FS}.Main()
}

func serve(ctx context.Context) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	logger := logging.New(os.Stdout, cfg.LogLevel, serviceName)

	pool, err := postgres.NewPool(ctx, postgres.Config{
		URL:              cfg.DatabaseURL,
		Application:      serviceName,
		MaxConns:         cfg.DBMaxConns,
		StatementTimeout: cfg.DBStatementTimeout,
	})
	if err != nil {
		return err
	}
	defer pool.Close()

	verifier := auth.NewVerifier(auth.Config{
		Issuer:   cfg.OIDCIssuer,
		JWKSURL:  cfg.OIDCJWKSURL,
		Audience: cfg.OIDCAudience,
	})
	publicAPI, err := api.NewHandler(logger, verifier, api.NewServer(pool, cfg.ContactRequestDailyLimit))
	if err != nil {
		return err
	}

	limits := httpserver.Limits{RequestTimeout: cfg.RequestTimeout, MaxInFlight: cfg.MaxInFlight}
	checks := map[string]health.Check{"postgres": postgres.Check(pool)}

	return httpserver.Run(ctx, logger, cfg.ShutdownTimeout,
		httpserver.New(cfg.HTTPAddr, httpserver.NewMux(logger, publicAPI, limits, checks)),
	)
}

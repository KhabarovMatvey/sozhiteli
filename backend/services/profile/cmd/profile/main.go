// Command profile runs the Profile service: the owner of user profiles and
// questionnaire answers. See docs/SERVICE_BOUNDARIES.md.
package main

import (
	"context"
	"os"

	"sozhiteli.internal/platform/app"
	"sozhiteli.internal/platform/auth"
	"sozhiteli.internal/platform/health"
	"sozhiteli.internal/platform/httpserver"
	"sozhiteli.internal/platform/logging"
	"sozhiteli.internal/platform/postgres"
	"sozhiteli.internal/profile/internal/api"
	"sozhiteli.internal/profile/internal/config"
	"sozhiteli.internal/profile/internal/internalapi"
	"sozhiteli.internal/profile/internal/store"
	"sozhiteli.internal/profile/migrations"
)

const serviceName = "profile"

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

	userVerifier := auth.NewVerifier(auth.Config{
		Issuer:   cfg.OIDCIssuer,
		JWKSURL:  cfg.OIDCJWKSURL,
		Audience: cfg.OIDCAudience,
	})
	serviceVerifier := auth.NewVerifier(auth.Config{
		Issuer:   cfg.OIDCIssuer,
		JWKSURL:  cfg.OIDCJWKSURL,
		Audience: cfg.InternalAudience,
	})

	queries := store.New(pool)
	publicAPI, err := api.NewHandler(logger, userVerifier, api.NewServer(queries))
	if err != nil {
		return err
	}
	internalAPI, err := internalapi.NewHandler(logger, serviceVerifier, internalapi.NewServer(queries))
	if err != nil {
		return err
	}

	limits := httpserver.Limits{RequestTimeout: cfg.RequestTimeout, MaxInFlight: cfg.MaxInFlight}
	checks := map[string]health.Check{"postgres": postgres.Check(pool)}

	return httpserver.Run(ctx, logger, cfg.ShutdownTimeout,
		httpserver.New(cfg.HTTPAddr, httpserver.NewMux(logger, publicAPI, limits, checks)),
		httpserver.New(cfg.InternalHTTPAddr, httpserver.NewMux(logger, internalAPI, limits, checks)),
	)
}

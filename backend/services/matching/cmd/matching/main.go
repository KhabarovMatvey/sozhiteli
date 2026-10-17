// Command matching runs the Matching service: candidate search and habit
// comparison on its own projection of profiles. See README.md, section 3.
package main

import (
	"context"
	"net/http"
	"os"
	"sync"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/clientcredentials"

	"sozhiteli.internal/matching/internal/api"
	"sozhiteli.internal/matching/internal/config"
	"sozhiteli.internal/matching/internal/profileclient"
	"sozhiteli.internal/matching/internal/projection"
	"sozhiteli.internal/matching/internal/store"
	"sozhiteli.internal/matching/migrations"
	"sozhiteli.internal/platform/app"
	"sozhiteli.internal/platform/auth"
	"sozhiteli.internal/platform/health"
	"sozhiteli.internal/platform/httpserver"
	"sozhiteli.internal/platform/logging"
	"sozhiteli.internal/platform/postgres"
)

const (
	serviceName = "matching"
	// outboundTimeout bounds every call this service makes to another one.
	outboundTimeout = 5 * time.Second
)

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

	profileClient, err := profileclient.NewClientWithResponses(
		cfg.ProfileInternalURL,
		profileclient.WithHTTPClient(serviceHTTPClient(cfg)),
	)
	if err != nil {
		return err
	}
	syncer := projection.NewSyncer(profileClient, pool, logger, projection.Config{
		Interval:  cfg.SyncInterval,
		BatchSize: cfg.SyncBatchSize,
	})

	verifier := auth.NewVerifier(auth.Config{
		Issuer:   cfg.OIDCIssuer,
		JWKSURL:  cfg.OIDCJWKSURL,
		Audience: cfg.OIDCAudience,
	})
	publicAPI, err := api.NewHandler(logger, verifier, api.NewServer(store.New(pool)))
	if err != nil {
		return err
	}

	// The sync loop stops together with the HTTP server, whatever the reason.
	ctx, cancel := context.WithCancel(ctx)
	var background sync.WaitGroup
	background.Go(func() { syncer.Run(ctx) })
	defer background.Wait()
	defer cancel()

	limits := httpserver.Limits{RequestTimeout: cfg.RequestTimeout, MaxInFlight: cfg.MaxInFlight}
	// Readiness depends on the own database only. It must not depend on
	// Profile: Matching keeps serving its projection while Profile is down.
	checks := map[string]health.Check{"postgres": postgres.Check(pool)}

	return httpserver.Run(ctx, logger, cfg.ShutdownTimeout,
		httpserver.New(cfg.HTTPAddr, httpserver.NewMux(logger, publicAPI, limits, checks)),
	)
}

// serviceHTTPClient returns an HTTP client that authenticates this service
// with OAuth2 client credentials. Tokens are fetched on demand, cached and
// renewed by the oauth2 package.
func serviceHTTPClient(cfg config.Config) *http.Client {
	credentials := clientcredentials.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
		TokenURL:     cfg.TokenURL,
	}
	// The token source keeps this context, so it must outlive any request.
	tokenCtx := context.WithValue(context.Background(), oauth2.HTTPClient, &http.Client{Timeout: outboundTimeout})
	client := credentials.Client(tokenCtx)
	client.Timeout = outboundTimeout
	return client
}

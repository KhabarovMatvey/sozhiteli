// Package config loads the Matching service configuration.
package config

import (
	"time"

	platform "sozhiteli.internal/platform/config"
)

// Config is everything the Matching service reads from the environment.
type Config struct {
	platform.Base

	// ProfileInternalURL is the base URL of the Profile internal API
	// (PROFILE_INTERNAL_URL).
	ProfileInternalURL string
	// TokenURL is the OIDC token endpoint used to obtain the service token
	// (OIDC_TOKEN_URL).
	TokenURL string
	// ClientID and ClientSecret are the client credentials of this service
	// (SERVICE_CLIENT_ID, SERVICE_CLIENT_SECRET).
	ClientID     string
	ClientSecret string

	// SyncInterval is the pause between polls when the feed has no new
	// changes (SYNC_INTERVAL).
	SyncInterval time.Duration
	// SyncBatchSize is the number of changes requested per poll
	// (SYNC_BATCH_SIZE, at most 500).
	SyncBatchSize int
}

// Load reads and validates the configuration.
func Load() (Config, error) {
	l := platform.NewLoader()
	cfg := Config{
		Base:               platform.LoadBase(l),
		ProfileInternalURL: l.RequiredString("PROFILE_INTERNAL_URL"),
		TokenURL:           l.RequiredString("OIDC_TOKEN_URL"),
		ClientID:           l.RequiredString("SERVICE_CLIENT_ID"),
		ClientSecret:       l.RequiredString("SERVICE_CLIENT_SECRET"),
		SyncInterval:       l.Duration("SYNC_INTERVAL", 5*time.Second),
		SyncBatchSize:      min(l.Int("SYNC_BATCH_SIZE", 200), 500),
	}
	return cfg, l.Err()
}

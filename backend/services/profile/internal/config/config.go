// Package config loads the Profile service configuration.
package config

import (
	platform "sozhiteli.internal/platform/config"
)

// Config is everything the Profile service reads from the environment.
type Config struct {
	platform.Base

	// InternalHTTPAddr is the listen address of the internal API
	// (INTERNAL_HTTP_ADDR). It must never be published outside the service
	// network.
	InternalHTTPAddr string
	// InternalAudience is the audience of service tokens accepted by the
	// internal API (INTERNAL_OIDC_AUDIENCE).
	InternalAudience string
}

// Load reads and validates the configuration.
func Load() (Config, error) {
	l := platform.NewLoader()
	cfg := Config{
		Base:             platform.LoadBase(l),
		InternalHTTPAddr: l.String("INTERNAL_HTTP_ADDR", ":9080"),
		InternalAudience: l.String("INTERNAL_OIDC_AUDIENCE", "sozhiteli-internal"),
	}
	return cfg, l.Err()
}

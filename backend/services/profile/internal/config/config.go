// Package config loads the Profile service configuration.
package config

import (
	"errors"

	platform "sozhiteli.internal/platform/config"
	"sozhiteli.internal/profile/internal/adminusers"
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

	// AdminUsers is optional server-only access to the identity directory.
	AdminUsers adminusers.Config
}

// Load reads and validates the configuration.
func Load() (Config, error) {
	l := platform.NewLoader()
	cfg := Config{
		Base:             platform.LoadBase(l),
		InternalHTTPAddr: l.String("INTERNAL_HTTP_ADDR", ":9080"),
		InternalAudience: l.String("INTERNAL_OIDC_AUDIENCE", "sozhiteli-internal"),
		AdminUsers: adminusers.Config{
			BaseURL:      l.String("KEYCLOAK_ADMIN_BASE_URL", "http://keycloak:8080"),
			Realm:        l.String("KEYCLOAK_ADMIN_REALM", "sozhiteli"),
			ClientID:     l.String("KEYCLOAK_ADMIN_CLIENT_ID", "profile-admin-reader"),
			ClientSecret: l.String("KEYCLOAK_ADMIN_CLIENT_SECRET", ""),
		},
	}
	return cfg, errors.Join(l.Err(), cfg.AdminUsers.Validate())
}

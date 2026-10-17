// Package config loads the Interaction service configuration.
package config

import (
	platform "sozhiteli.internal/platform/config"
)

// Config is everything the Interaction service reads from the environment.
type Config struct {
	platform.Base

	// ContactRequestDailyLimit is how many new contact requests one user may
	// create per 24 hours (CONTACT_REQUEST_DAILY_LIMIT). It limits abuse of
	// the most sensitive operation of the system (README.md, section 7).
	ContactRequestDailyLimit int
}

// Load reads and validates the configuration.
func Load() (Config, error) {
	l := platform.NewLoader()
	cfg := Config{
		Base:                     platform.LoadBase(l),
		ContactRequestDailyLimit: l.Int("CONTACT_REQUEST_DAILY_LIMIT", 20),
	}
	return cfg, l.Err()
}

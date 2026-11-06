package config

import (
	"testing"
)

func TestAdminDirectoryConfigurationIsOptional(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://local/profile")
	t.Setenv("OIDC_ISSUER", "http://localhost:8081/realms/sozhiteli")
	t.Setenv("OIDC_JWKS_URL", "http://keycloak:8080/realms/sozhiteli/protocol/openid-connect/certs")
	t.Setenv("KEYCLOAK_ADMIN_BASE_URL", "")
	t.Setenv("KEYCLOAK_ADMIN_REALM", "")
	t.Setenv("KEYCLOAK_ADMIN_CLIENT_ID", "")
	t.Setenv("KEYCLOAK_ADMIN_CLIENT_SECRET", "")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AdminUsers.ClientSecret != "" || cfg.AdminUsers.BaseURL != "http://keycloak:8080" || cfg.AdminUsers.Realm != "sozhiteli" || cfg.AdminUsers.ClientID != "profile-admin-reader" {
		t.Fatalf("unexpected directory defaults: %+v", cfg.AdminUsers)
	}
	t.Setenv("KEYCLOAK_ADMIN_BASE_URL", "http://user:password@keycloak:8080")
	if _, err := Load(); err == nil {
		t.Fatal("malformed directory URL was accepted")
	}
}

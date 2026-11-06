package adminusers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestListReadsOnlyAllowedEndpointsWithIdenticalFilter(t *testing.T) {
	var tokenCalls, listCalls, countCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/realms/sozhiteli/protocol/openid-connect/token":
			tokenCalls++
			if r.Method != http.MethodPost || r.ParseForm() != nil || r.Form.Get("grant_type") != "client_credentials" ||
				r.Form.Get("client_id") != "profile-admin-reader" || r.Form.Get("client_secret") != "server-only-secret" {
				t.Error("token request does not use the dedicated service account")
			}
			_, _ = w.Write([]byte(`{"access_token":"directory-token"}`))
		case "/admin/realms/sozhiteli/users/count":
			countCalls++
			if r.Method != http.MethodGet || r.Header.Get("Authorization") != "Bearer directory-token" || r.URL.Query().Get("search") != "alice+test@example.test" {
				t.Error("count filter or authorization differs")
			}
			_, _ = w.Write([]byte(`3`))
		case "/admin/realms/sozhiteli/users":
			listCalls++
			q := r.URL.Query()
			if r.Method != http.MethodGet || r.Header.Get("Authorization") != "Bearer directory-token" || q.Get("search") != "alice+test@example.test" || q.Get("first") != "1" || q.Get("max") != "2" || q.Get("briefRepresentation") != "true" {
				t.Error("list filter, page or authorization differs")
			}
			_, _ = w.Write([]byte(`[
				{"id":"00000000-0000-0000-0000-000000000001","username":"alice@example.test","email":"alice@example.test","enabled":true,"emailVerified":true,"createdTimestamp":1700000000000,"credentials":[{"secretData":"private-password"}],"attributes":{"private":"hidden"}},
				{"id":"00000000-0000-0000-0000-000000000002","username":"service-account-reader","serviceAccountClientId":"reader","enabled":true}
			]`))
		default:
			t.Errorf("unexpected endpoint: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	client, err := New(Config{BaseURL: server.URL, Realm: "sozhiteli", ClientID: "profile-admin-reader", ClientSecret: "server-only-secret"})
	if err != nil {
		t.Fatal(err)
	}
	page, err := client.List(t.Context(), 1, 2, "alice+test@example.test")
	if err != nil {
		t.Fatal(err)
	}
	if tokenCalls != 1 || countCalls != 1 || listCalls != 1 || page.Total != 3 || len(page.Users) != 2 {
		t.Fatalf("unexpected calls or page: token=%d count=%d list=%d page=%+v", tokenCalls, countCalls, listCalls, page)
	}
	if page.Users[0].CreatedAt == nil || page.Users[0].CreatedAt.UnixMilli() != 1700000000000 || page.Users[0].ServiceAccount || !page.Users[1].ServiceAccount || page.Users[1].CreatedAt != nil {
		t.Fatalf("account metadata was not mapped correctly: %+v", page.Users)
	}
	raw, err := json.Marshal(page)
	if err != nil || strings.Contains(string(raw), "private") || strings.Contains(string(raw), "credentials") || strings.Contains(string(raw), "hidden") {
		t.Fatalf("unexpected fields escaped directory DTO: %s", raw)
	}
}

func TestDirectoryNeverFollowsRedirects(t *testing.T) {
	for _, redirectAt := range []string{"token", "count", "users"} {
		t.Run(redirectAt, func(t *testing.T) {
			var leaked atomic.Int32
			other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				leaked.Add(1)
				_, _ = w.Write([]byte(`[]`))
			}))
			defer other.Close()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				endpoint := "users"
				if strings.HasSuffix(r.URL.Path, "/token") {
					endpoint = "token"
				} else if strings.HasSuffix(r.URL.Path, "/count") {
					endpoint = "count"
				}
				if endpoint == redirectAt {
					http.Redirect(w, r, other.URL, http.StatusTemporaryRedirect)
					return
				}
				if endpoint == "token" {
					_, _ = w.Write([]byte(`{"access_token":"sensitive-token"}`))
				} else {
					_, _ = w.Write([]byte(`0`))
				}
			}))
			defer server.Close()
			client, err := New(Config{BaseURL: server.URL, Realm: "sozhiteli", ClientID: "reader", ClientSecret: "private"})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := client.List(t.Context(), 0, 20, ""); !errors.Is(err, errUnavailable) {
				t.Errorf("redirect error = %v", err)
			}
			if leaked.Load() != 0 {
				t.Fatal("request reached redirect destination")
			}
		})
	}
}

func TestDirectoryFailuresAreSanitized(t *testing.T) {
	for _, body := range []string{`private-upstream-details`, `{"id":"not-a-uuid"}`, `[{"id":"broken"}]`, strings.Repeat("private", 190000)} {
		t.Run("invalid-response", func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/token") {
					_, _ = w.Write([]byte(`{"access_token":"private-access-token"}`))
				} else if strings.HasSuffix(r.URL.Path, "/count") {
					_, _ = w.Write([]byte(`1`))
				} else {
					_, _ = w.Write([]byte(body))
				}
			}))
			defer server.Close()
			client, err := New(Config{BaseURL: server.URL, Realm: "sozhiteli", ClientID: "reader", ClientSecret: "private-client-secret"})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := client.List(t.Context(), 0, 20, "private-email"); !errors.Is(err, errUnavailable) || strings.Contains(err.Error(), "private") || strings.Contains(err.Error(), server.URL) {
				t.Fatalf("upstream failure was not sanitized: %v", err)
			}
		})
	}
}

func TestDirectoryHonorsCallerDeadline(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer server.Close()
	client, err := New(Config{BaseURL: server.URL, Realm: "sozhiteli", ClientID: "reader", ClientSecret: "private"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	start := time.Now()
	if _, err := client.List(ctx, 0, 20, ""); !errors.Is(err, errUnavailable) {
		t.Fatalf("cancelled request error = %v", err)
	}
	if time.Since(start) > time.Second {
		t.Fatal("directory ignored caller cancellation")
	}
}

func TestDirectoryConfiguration(t *testing.T) {
	for _, endpoint := range []string{"", "//keycloak:8080", "file:///tmp", "http://user:pass@host", "http://host/path", "http://host?token=private", "http://host#fragment", "http://host:invalid", "http://host/%2e%2e", "http://host\n"} {
		if err := (Config{BaseURL: endpoint, Realm: "sozhiteli", ClientID: "reader"}).Validate(); err == nil {
			t.Errorf("accepted malformed endpoint %q", endpoint)
		}
	}
	for _, realm := range []string{"", "..", "master/../sozhiteli", "master?x=y", "has space"} {
		if err := (Config{BaseURL: "http://keycloak:8080", Realm: realm, ClientID: "reader"}).Validate(); err == nil {
			t.Errorf("accepted malformed realm %q", realm)
		}
	}
	for _, endpoint := range []string{"http://keycloak:8080", "https://identity.example.test/id/"} {
		client, err := New(Config{BaseURL: endpoint, Realm: "sozhiteli", ClientID: "reader"})
		if err != nil || client != nil {
			t.Fatalf("missing secret must disable only directory feature: client=%v error=%v", client, err)
		}
	}
}

func TestExistsReadsOneAccountAndReturnsOnlyPresence(t *testing.T) {
	const present = "00000000-0000-4000-8000-000000000042"
	const absent = "00000000-0000-4000-8000-000000000043"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/realms/sozhiteli/protocol/openid-connect/token":
			_, _ = w.Write([]byte(`{"access_token":"directory-token"}`))
		case "/admin/realms/sozhiteli/users/" + present:
			if r.Method != http.MethodGet || r.Header.Get("Authorization") != "Bearer directory-token" {
				t.Error("account read does not use the service token")
			}
			// Attributes must never leave the client, even when the provider sends them.
			_, _ = w.Write([]byte(`{"id":"` + present + `","username":"alice","attributes":{"secret":["value"]}}`))
		case "/admin/realms/sozhiteli/users/" + absent:
			w.WriteHeader(http.StatusNotFound)
		default:
			t.Errorf("unexpected directory path %q", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	client, err := New(Config{BaseURL: server.URL, Realm: "sozhiteli", ClientID: "profile-admin-reader", ClientSecret: "server-only-secret"})
	if err != nil || client == nil {
		t.Fatalf("New: client=%v error=%v", client, err)
	}
	if found, err := client.Exists(t.Context(), uuid.MustParse(present)); err != nil || !found {
		t.Fatalf("present account: found=%v error=%v", found, err)
	}
	if found, err := client.Exists(t.Context(), uuid.MustParse(absent)); err != nil || found {
		t.Fatalf("absent account: found=%v error=%v", found, err)
	}
	var unconfigured *Client
	if _, err := unconfigured.Exists(t.Context(), uuid.MustParse(present)); err == nil {
		t.Fatal("unconfigured client reported an account")
	}
}

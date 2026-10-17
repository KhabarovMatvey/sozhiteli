package health

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newServer(t *testing.T, checks map[string]Check) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	Register(mux, checks)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestLivenessIgnoresFailingChecks(t *testing.T) {
	srv := newServer(t, map[string]Check{
		"postgres": func(context.Context) error { return errors.New("down") },
	})

	resp, err := http.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d", resp.StatusCode)
	}
}

func TestReadinessFailsWithoutLeakingReason(t *testing.T) {
	srv := newServer(t, map[string]Check{
		"postgres": func(context.Context) error { return errors.New("connection refused to 10.0.0.5") },
	})

	resp, err := http.Get(srv.URL + "/readyz")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("status = %d", resp.StatusCode)
	}
	if strings.Contains(string(body), "10.0.0.5") {
		t.Errorf("readiness leaked the failure reason: %s", body)
	}
	if err := Probe(context.Background(), srv.URL+"/readyz"); err == nil {
		t.Error("Probe succeeded against a failing readiness endpoint")
	}
}

func TestProbeSucceedsWhenReady(t *testing.T) {
	srv := newServer(t, map[string]Check{
		"postgres": func(context.Context) error { return nil },
	})

	if err := Probe(context.Background(), srv.URL+"/readyz"); err != nil {
		t.Errorf("Probe failed against a healthy endpoint: %v", err)
	}
}

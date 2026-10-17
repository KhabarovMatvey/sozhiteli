// Package health provides liveness and readiness endpoints.
//
//	GET /healthz - the process is running. Never touches dependencies.
//	GET /readyz  - the service can serve requests: every check passes.
//
// Readiness must only check dependencies the service cannot work without (its
// own database). It must NOT check other services: one unavailable service
// would otherwise take its neighbours out of rotation (cascading failure).
package health

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Check reports whether one dependency is usable.
type Check func(ctx context.Context) error

const checkTimeout = 2 * time.Second

type response struct {
	Status string            `json:"status"`
	Checks map[string]string `json:"checks,omitempty"`
}

// Register adds /healthz and /readyz to mux.
func Register(mux *http.ServeMux, checks map[string]Check) {
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		write(w, http.StatusOK, response{Status: "ok"})
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), checkTimeout)
		defer cancel()

		res := response{Status: "ok", Checks: make(map[string]string, len(checks))}
		status := http.StatusOK
		for name, check := range checks {
			if err := check(ctx); err != nil {
				// The reason stays in the service; the endpoint is reachable
				// from outside and must not describe the infrastructure.
				res.Checks[name] = "fail"
				res.Status = "unavailable"
				status = http.StatusServiceUnavailable
				continue
			}
			res.Checks[name] = "ok"
		}
		write(w, status, res)
	})
}

func write(w http.ResponseWriter, status int, res response) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(res)
}

// Probe calls a readiness URL and returns an error unless it answers 200.
// Services use it for the `healthcheck` subcommand, because their container
// image contains no shell or curl.
func Probe(ctx context.Context, url string) error {
	ctx, cancel := context.WithTimeout(ctx, checkTimeout+time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build probe request: %w", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("probe %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("probe %s: status %d", url, resp.StatusCode)
	}
	return nil
}

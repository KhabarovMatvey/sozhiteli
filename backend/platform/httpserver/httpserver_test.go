package httpserver

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"sozhiteli.internal/platform/logging"
)

var discard = slog.New(slog.NewTextHandler(io.Discard, nil))

func TestRequestIDGeneratesAndPropagates(t *testing.T) {
	var seen string
	h := Chain(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		seen = logging.RequestID(r.Context())
	}), RequestID())

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if seen == "" {
		t.Fatal("request id was not generated")
	}
	if got := rec.Header().Get(RequestIDHeader); got != seen {
		t.Errorf("response header = %q, context = %q", got, seen)
	}
}

func TestRequestIDAcceptsOnlySafeValues(t *testing.T) {
	cases := map[string]bool{
		"client-request-0001":           true,
		"short":                         false,
		"has spaces in the identifier":  false,
		"line\nbreak-injection-attempt": false,
	}
	for value, accepted := range cases {
		var seen string
		h := Chain(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			seen = logging.RequestID(r.Context())
		}), RequestID())

		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set(RequestIDHeader, value)
		h.ServeHTTP(httptest.NewRecorder(), req)

		if (seen == value) != accepted {
			t.Errorf("value %q: accepted = %v, want %v", value, seen == value, accepted)
		}
	}
}

func TestRecoverReturnsProblem(t *testing.T) {
	h := Chain(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}), Recover(discard))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/problem+json" {
		t.Errorf("Content-Type = %q", got)
	}
}

func TestLimitInFlightShedsExcessRequests(t *testing.T) {
	release := make(chan struct{})
	entered := make(chan struct{})
	h := Chain(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		entered <- struct{}{}
		<-release
	}), LimitInFlight(1))

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	}()
	<-entered

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	close(release)
	wg.Wait()

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("Retry-After is not set")
	}
}

func TestTimeoutCancelsContext(t *testing.T) {
	h := Chain(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
			w.WriteHeader(http.StatusGatewayTimeout)
		case <-time.After(5 * time.Second):
			w.WriteHeader(http.StatusOK)
		}
	}), Timeout(20*time.Millisecond))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusGatewayTimeout {
		t.Errorf("handler did not observe the deadline, status = %d", rec.Code)
	}
}

// TestRunWaitsForInFlightRequests is the graceful shutdown check: a request
// that is being handled when shutdown starts must still complete.
func TestRunWaitsForInFlightRequests(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close()

	started := make(chan struct{})
	srv := New(addr, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		time.Sleep(150 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))

	ctx, cancel := context.WithCancel(context.Background())
	runDone := make(chan error, 1)
	go func() { runDone <- Run(ctx, discard, 5*time.Second, srv) }()

	var resp *http.Response
	reqDone := make(chan error, 1)
	go func() {
		var err error
		for range 50 {
			resp, err = http.Get("http://" + addr + "/")
			if err == nil {
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
		reqDone <- err
	}()

	<-started
	cancel()

	if err := <-reqDone; err != nil {
		t.Fatalf("in-flight request failed during shutdown: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d", resp.StatusCode)
	}
	if err := <-runDone; err != nil {
		t.Errorf("Run returned %v", err)
	}
}

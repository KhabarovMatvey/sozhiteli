package httpserver

import (
	"log/slog"
	"net/http"
	"time"

	"sozhiteli.internal/platform/health"
)

// Limits are the protective limits applied to every API request.
type Limits struct {
	RequestTimeout time.Duration
	MaxInFlight    int
}

// maxBodyBytes is far above any request the contracts allow and far below
// anything that could exhaust memory.
const maxBodyBytes = 64 << 10

// NewMux assembles the handler of one listener: health endpoints plus the API
// behind the standard middleware chain.
//
// Health endpoints stay outside the load-shedding limit, so an overloaded
// instance still answers its probes.
func NewMux(logger *slog.Logger, api http.Handler, limits Limits, checks map[string]health.Check) http.Handler {
	mux := http.NewServeMux()
	health.Register(mux, checks)
	mux.Handle("/", Chain(api,
		RequestID(),
		Recover(logger),
		AccessLog(logger),
		LimitInFlight(limits.MaxInFlight),
		Timeout(limits.RequestTimeout),
		MaxBody(maxBodyBytes),
	))
	return mux
}

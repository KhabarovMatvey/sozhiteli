// Package httpserver contains the HTTP server lifecycle and the middleware
// shared by every service.
package httpserver

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"
)

// New returns an http.Server with conservative timeouts. Requests that need a
// tighter deadline get it from the Timeout middleware.
func New(addr string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       90 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
}

// Run serves every server until ctx is cancelled or one of them fails, then
// shuts all of them down gracefully: listeners close, in-flight requests get
// up to shutdownTimeout to finish.
func Run(ctx context.Context, logger *slog.Logger, shutdownTimeout time.Duration, servers ...*http.Server) error {
	errCh := make(chan error, len(servers))
	for _, srv := range servers {
		ln, err := (&net.ListenConfig{}).Listen(ctx, "tcp", srv.Addr)
		if err != nil {
			return fmt.Errorf("listen on %s: %w", srv.Addr, err)
		}
		logger.Info("http server listening", "addr", ln.Addr().String())
		go func() {
			if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
				errCh <- fmt.Errorf("serve %s: %w", srv.Addr, err)
			}
		}()
	}

	var runErr error
	select {
	case <-ctx.Done():
		logger.Info("shutdown requested")
	case runErr = <-errCh:
	}

	// The parent context is already cancelled, so the shutdown deadline needs
	// a context of its own.
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), shutdownTimeout)
	defer cancel()
	for _, srv := range servers {
		if err := srv.Shutdown(shutdownCtx); err != nil {
			runErr = errors.Join(runErr, fmt.Errorf("shutdown %s: %w", srv.Addr, err))
		}
	}
	return runErr
}

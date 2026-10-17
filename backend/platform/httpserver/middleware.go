package httpserver

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"

	"sozhiteli.internal/platform/logging"
	"sozhiteli.internal/platform/problem"
)

// RequestIDHeader carries the request identifier in both directions.
const RequestIDHeader = "X-Request-Id"

// Middleware wraps a handler.
type Middleware func(http.Handler) http.Handler

// Chain applies middleware so that the first one is the outermost.
func Chain(h http.Handler, mws ...Middleware) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}

// RequestID takes the identifier from the request header when it is well
// formed, otherwise generates one, and exposes it to logs and to the client.
func RequestID() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := r.Header.Get(RequestIDHeader)
			if !validRequestID(id) {
				id = newRequestID()
			}
			w.Header().Set(RequestIDHeader, id)
			next.ServeHTTP(w, r.WithContext(logging.WithRequestID(r.Context(), id)))
		})
	}
}

// validRequestID accepts only short tokens of safe characters: the value ends
// up in logs and must not be able to forge log content.
func validRequestID(id string) bool {
	if len(id) < 8 || len(id) > 64 {
		return false
	}
	for _, c := range id {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '-', c == '_':
		default:
			return false
		}
	}
	return true
}

func newRequestID() string {
	var b [16]byte
	// crypto/rand.Read never returns an error on supported platforms.
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *statusRecorder) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
	}
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.ResponseWriter.Write(b)
	r.bytes += n
	return n, err
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (r *statusRecorder) Unwrap() http.ResponseWriter {
	return r.ResponseWriter
}

// AccessLog writes one record per request. It logs the method, path, status,
// size and duration only: no query string, headers or bodies, because those
// can carry personal data and tokens.
func AccessLog(logger *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w}

			next.ServeHTTP(rec, r)

			logger.InfoContext(r.Context(), "http request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"bytes", rec.bytes,
				"duration_ms", time.Since(start).Milliseconds(),
			)
		})
	}
}

// Recover turns a panic in a handler into a 500 response and a log record
// instead of a dropped connection.
func Recover(logger *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				rec := recover()
				if rec == nil {
					return
				}
				// http.ErrAbortHandler is the documented way to abort a response
				// on purpose; it must reach the server untouched.
				if err, ok := rec.(error); ok && errors.Is(err, http.ErrAbortHandler) {
					panic(rec)
				}
				logger.ErrorContext(r.Context(), "panic in http handler",
					"panic", rec,
					"stack", string(debug.Stack()),
				)
				problem.Write(w, r, problem.Internal())
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// Timeout bounds the time a request may spend in the handler. Handlers and
// everything they call must pass r.Context() down, so database queries and
// outgoing calls are cancelled when the deadline passes.
func Timeout(d time.Duration) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), d)
			defer cancel()
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// MaxBody rejects request bodies larger than limit bytes.
func MaxBody(limit int64) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, limit)
			next.ServeHTTP(w, r)
		})
	}
}

// LimitInFlight sheds load: when more than limit requests are being handled
// at once, new ones get an immediate 503 with Retry-After instead of queueing
// until they time out. This keeps an overloaded instance responsive and stops
// overload from spreading to callers.
func LimitInFlight(limit int) Middleware {
	slots := make(chan struct{}, limit)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			select {
			case slots <- struct{}{}:
				defer func() { <-slots }()
				next.ServeHTTP(w, r)
			default:
				problem.Write(w, r, problem.Unavailable(time.Second))
			}
		})
	}
}

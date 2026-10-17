// Package logging configures structured JSON logging on top of log/slog.
//
// Logging rule for every service: never log request or response bodies,
// Authorization headers, tokens, contacts or profile field values. Identifiers
// (user_id, request_id) are allowed.
package logging

import (
	"context"
	"io"
	"log/slog"
	"strings"
)

type requestIDKey struct{}

// WithRequestID returns a context carrying the request identifier, so that
// every log record written with that context includes it.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey{}, id)
}

// RequestID returns the request identifier stored in ctx, or "".
func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}

// New returns a JSON logger that tags every record with the service name and,
// when the context carries one, the request identifier.
func New(w io.Writer, level, service string) *slog.Logger {
	h := slog.NewJSONHandler(w, &slog.HandlerOptions{Level: parseLevel(level)})
	return slog.New(contextHandler{Handler: h}).With("service", service)
}

func parseLevel(level string) slog.Level {
	switch strings.ToLower(level) {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

type contextHandler struct {
	slog.Handler
}

func (h contextHandler) Handle(ctx context.Context, r slog.Record) error {
	if id := RequestID(ctx); id != "" {
		r.AddAttrs(slog.String("request_id", id))
	}
	return h.Handler.Handle(ctx, r)
}

func (h contextHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return contextHandler{Handler: h.Handler.WithAttrs(attrs)}
}

func (h contextHandler) WithGroup(name string) slog.Handler {
	return contextHandler{Handler: h.Handler.WithGroup(name)}
}

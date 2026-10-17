package httpserver

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"sozhiteli.internal/platform/problem"
)

// WriteError renders an error returned by a handler. Expected errors
// (*problem.Error) go to the client as they are. Anything else is logged with
// the request identifier and hidden behind a generic 500, so internal details
// never reach the client.
func WriteError(logger *slog.Logger, w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, context.DeadlineExceeded) {
		logger.WarnContext(r.Context(), "request deadline exceeded")
		problem.Write(w, r, problem.Timeout())
		return
	}
	if errors.Is(err, context.Canceled) {
		// The client went away; nobody is left to read a response.
		return
	}

	e, unexpected := problem.FromError(err)
	if unexpected {
		logger.ErrorContext(r.Context(), "request failed", "error", err.Error())
	}
	problem.Write(w, r, e)
}

// NotFound and MethodNotAllowed are router fallbacks that keep the error
// format uniform for paths outside the contract.
func NotFound(w http.ResponseWriter, r *http.Request) {
	problem.Write(w, r, problem.NotFound(problem.CodeNotFound, "no such operation"))
}

// MethodNotAllowed answers 405 in the uniform error format.
func MethodNotAllowed(w http.ResponseWriter, r *http.Request) {
	problem.Write(w, r, problem.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed for this path"))
}

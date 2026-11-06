// Package api is the public HTTP API of the Matching service.
//
// api.gen.go is generated from contracts/openapi/matching.v1.yaml (npm run gen)
// and must not be edited by hand.
package api

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"sozhiteli.internal/platform/auth"
	"sozhiteli.internal/platform/httpserver"
	"sozhiteli.internal/platform/openapi"
	"sozhiteli.internal/platform/problem"
)

// NewHandler wires the API: authentication, then validation of the request
// against the contract, then the operation.
func NewHandler(logger *slog.Logger, verifier *auth.Verifier, server StrictServerInterface) (http.Handler, error) {
	spec, err := GetSpec()
	if err != nil {
		return nil, err
	}
	if err := openapi.Prepare(context.Background(), spec); err != nil {
		return nil, err
	}

	router := chi.NewRouter()
	router.NotFound(httpserver.NotFound)
	router.MethodNotAllowed(httpserver.MethodNotAllowed)
	router.Use(adminNoStore, verifier.Middleware(), openapi.RequestValidator(spec))

	strict := NewStrictHandlerWithOptions(server, nil, StrictHTTPServerOptions{
		RequestErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, _ error) {
			problem.Write(w, r, problem.InvalidRequest("request body cannot be decoded"))
		},
		ResponseErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			httpserver.WriteError(logger, w, r, err)
		},
	})
	return HandlerWithOptions(strict, ChiServerOptions{
		BaseRouter: router,
		ErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, _ error) {
			problem.Write(w, r, problem.InvalidRequest("request parameters cannot be decoded"))
		},
	}), nil
}

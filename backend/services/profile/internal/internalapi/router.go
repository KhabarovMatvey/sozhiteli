// Package internalapi is the INTERNAL HTTP API of the Profile service. It is
// served on a separate listener that the edge proxy does not route to, and it
// accepts only service tokens with the required role.
//
// api.gen.go is generated from contracts/openapi/profile-internal.v1.yaml
// (npm run gen) and must not be edited by hand.
package internalapi

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

// NewHandler wires the internal API: service authentication, role check,
// validation of the request against the contract, then the operation.
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
	router.Use(
		verifier.Middleware(),
		auth.RequireRole(RoleReadProfileChanges),
		openapi.RequestValidator(spec),
	)

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

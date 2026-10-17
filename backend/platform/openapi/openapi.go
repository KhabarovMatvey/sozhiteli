// Package openapi enforces an OpenAPI contract at runtime: every request is
// validated against the specification before it reaches a handler.
package openapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	nethttpmiddleware "github.com/oapi-codegen/nethttp-middleware"

	"sozhiteli.internal/platform/problem"
)

// Prepare validates the specification document itself and removes its server
// list, so that request matching does not depend on the host the service is
// reached by.
func Prepare(ctx context.Context, spec *openapi3.T) error {
	spec.Servers = nil
	if err := spec.Validate(ctx); err != nil {
		return fmt.Errorf("openapi specification is invalid: %w", err)
	}
	return nil
}

// RequestValidator returns middleware that answers 400 to requests that do
// not match the specification (unknown parameters values, wrong types, missing
// required fields, violated length and range limits) and 404/405 to requests
// for operations the specification does not define.
//
// Authentication is not handled here: install the auth middleware before it.
func RequestValidator(spec *openapi3.T) func(http.Handler) http.Handler {
	return nethttpmiddleware.OapiRequestValidatorWithOptions(spec, &nethttpmiddleware.Options{
		Options: openapi3filter.Options{
			AuthenticationFunc: openapi3filter.NoopAuthenticationFunc,
		},
		DoNotValidateServers: true,
		ErrorHandlerWithOpts: func(_ context.Context, err error, w http.ResponseWriter, r *http.Request, opts nethttpmiddleware.ErrorHandlerOpts) {
			switch opts.StatusCode {
			case http.StatusNotFound:
				problem.Write(w, r, problem.NotFound(problem.CodeNotFound, "no such operation"))
			case http.StatusMethodNotAllowed:
				problem.Write(w, r, problem.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed for this path"))
			default:
				problem.Write(w, r, problem.InvalidRequest(describe(err)))
			}
		},
	})
}

// describe builds a client-facing explanation that names the offending part of
// the request and the violated rule but never echoes the submitted value.
func describe(err error) string {
	var reqErr *openapi3filter.RequestError
	if !errors.As(err, &reqErr) {
		return "request does not match the API contract"
	}

	where := "request"
	switch {
	case reqErr.Parameter != nil:
		where = fmt.Sprintf("%s parameter %q", reqErr.Parameter.In, reqErr.Parameter.Name)
	case reqErr.RequestBody != nil:
		where = "request body"
	}

	var schemaErr *openapi3.SchemaError
	if errors.As(reqErr.Err, &schemaErr) {
		if path := strings.Join(schemaErr.JSONPointer(), "."); path != "" {
			where += " field " + path
		}
		return where + ": " + schemaErr.Reason
	}
	if reqErr.Reason != "" {
		return where + ": " + reqErr.Reason
	}
	return where + " does not match the API contract"
}

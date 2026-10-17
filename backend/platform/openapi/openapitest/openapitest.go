// Package openapitest is a TEST-ONLY helper for contract tests: it checks that
// what a handler actually returned is what the OpenAPI specification promises.
package openapitest

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers/gorillamux"
)

// SampleUUID is substituted for every path parameter when a test needs a
// concrete URL for an operation.
const SampleUUID = "3f2b8c1e-6d4a-4e0b-9c7a-1a2b3c4d5e6f"

// Operation is one operation of a specification.
type Operation struct {
	ID     string
	Method string
	// Path is the path template, for example /v1/candidates/{user_id}.
	Path string
	// URL is Path with every parameter replaced by SampleUUID.
	URL string
	// Implemented reflects the x-implementation-status extension.
	Implemented bool
	// HasBody reports whether the operation declares a request body.
	HasBody bool
}

// Operations lists every operation of spec in a stable order.
func Operations(t testing.TB, spec *openapi3.T) []Operation {
	t.Helper()

	var ops []Operation
	for path, item := range spec.Paths.Map() {
		for method, op := range item.Operations() {
			status, _ := op.Extensions["x-implementation-status"].(string)
			if status != "implemented" && status != "planned" {
				t.Errorf("%s %s: x-implementation-status must be implemented or planned, got %q", method, path, status)
			}
			ops = append(ops, Operation{
				ID:          op.OperationID,
				Method:      method,
				Path:        path,
				URL:         fillPathParams(path),
				Implemented: status == "implemented",
				HasBody:     op.RequestBody != nil,
			})
		}
	}
	sort.Slice(ops, func(i, j int) bool { return ops[i].ID < ops[j].ID })
	return ops
}

func fillPathParams(path string) string {
	var b strings.Builder
	for {
		open := strings.IndexByte(path, '{')
		if open < 0 {
			b.WriteString(path)
			return b.String()
		}
		end := strings.IndexByte(path[open:], '}')
		b.WriteString(path[:open])
		b.WriteString(SampleUUID)
		path = path[open+end+1:]
	}
}

// AssertResponse fails the test unless the recorded response is one the
// specification declares for the request's operation: status, content type
// and body schema.
func AssertResponse(t testing.TB, spec *openapi3.T, req *http.Request, rec *httptest.ResponseRecorder) {
	t.Helper()

	router, err := gorillamux.NewRouter(spec)
	if err != nil {
		t.Fatalf("build spec router: %v", err)
	}
	route, pathParams, err := router.FindRoute(req)
	if err != nil {
		t.Fatalf("%s %s is not an operation of the specification: %v", req.Method, req.URL.Path, err)
	}

	input := &openapi3filter.ResponseValidationInput{
		RequestValidationInput: &openapi3filter.RequestValidationInput{
			Request:    req,
			PathParams: pathParams,
			Route:      route,
			Options: &openapi3filter.Options{
				AuthenticationFunc:    openapi3filter.NoopAuthenticationFunc,
				IncludeResponseStatus: true,
			},
		},
		Status: rec.Code,
		Header: rec.Header(),
		Body:   io.NopCloser(bytes.NewReader(rec.Body.Bytes())),
	}
	if err := openapi3filter.ValidateResponse(req.Context(), input); err != nil {
		t.Errorf("%s %s -> %d violates the contract: %v\nbody: %s",
			req.Method, req.URL.Path, rec.Code, err, rec.Body.String())
	}
}

// CheckAuthenticationRequired verifies, for every operation of spec, that the
// handler routes it and rejects an anonymous caller with a contract-conformant
// 401.
func CheckAuthenticationRequired(t *testing.T, spec *openapi3.T, handler http.Handler) {
	t.Helper()
	for _, op := range Operations(t, spec) {
		t.Run(op.ID, func(t *testing.T) {
			req := httptest.NewRequestWithContext(t.Context(), op.Method, op.URL, nil)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401", rec.Code)
			}
			AssertResponse(t, spec, req, rec)
		})
	}
}

// CheckImplementationStatus verifies that the x-implementation-status of every
// operation tells the truth: "planned" operations answer an explicit 501 and
// never a fake success, "implemented" ones never answer 501.
//
// Operations with a request body are skipped (an empty body is rejected by
// validation before the operation runs); cover them with dedicated tests.
// query supplies the required query string of an operation, keyed by
// operationId, for example {"listContactRequests": "direction=incoming"}.
// Keys are matched case-insensitively, because the code generator capitalises
// operation identifiers in the embedded specification.
func CheckImplementationStatus(t *testing.T, spec *openapi3.T, handler http.Handler, token string, query map[string]string) {
	t.Helper()
	for _, op := range Operations(t, spec) {
		if op.HasBody {
			continue
		}
		t.Run(op.ID, func(t *testing.T) {
			target := op.URL
			for id, q := range query {
				if strings.EqualFold(id, op.ID) {
					target += "?" + q
				}
			}
			req := httptest.NewRequestWithContext(t.Context(), op.Method, target, nil)
			req.Header.Set("Authorization", "Bearer "+token)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			AssertResponse(t, spec, req, rec)
			notImplemented := rec.Code == http.StatusNotImplemented
			if op.Implemented && notImplemented {
				t.Errorf("operation is marked implemented but answers 501")
			}
			if !op.Implemented && !notImplemented {
				t.Errorf("operation is marked planned but answers %d: %s", rec.Code, rec.Body.String())
			}
		})
	}
}

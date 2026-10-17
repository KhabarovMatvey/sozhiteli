// Package problem implements the single error format of every HTTP API in the
// project: RFC 9457 problem details extended with a stable machine-readable
// code.
//
// Handlers return *Error values; Write turns any error into a response.
// Unknown errors become a 500 without internal details.
package problem

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"sozhiteli.internal/platform/logging"
)

// ContentType is the media type of every error response.
const ContentType = "application/problem+json"

// Codes shared by all services. Service-specific codes are declared in the
// service that returns them and documented in its OpenAPI contract.
const (
	CodeInvalidRequest   = "invalid_request"
	CodeUnauthorized     = "unauthorized"
	CodeForbidden        = "forbidden"
	CodeNotFound         = "not_found"
	CodeValidationFailed = "validation_failed"
	CodeRateLimited      = "rate_limited"
	CodeInternal         = "internal_error"
	CodeNotImplemented   = "not_implemented"
	CodeUnavailable      = "service_unavailable"
	CodeTimeout          = "request_timeout"
)

// FieldError describes one invalid field of a request.
type FieldError struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Error is an error that knows how to present itself to an API client.
type Error struct {
	Status     int
	Code       string
	Title      string
	Detail     string
	Fields     []FieldError
	RetryAfter time.Duration
}

func (e *Error) Error() string {
	if e.Detail != "" {
		return e.Code + ": " + e.Detail
	}
	return e.Code
}

// New builds an Error with an arbitrary status and code.
func New(status int, code, detail string) *Error {
	return &Error{Status: status, Code: code, Title: http.StatusText(status), Detail: detail}
}

// InvalidRequest reports a request that does not match the contract schema.
func InvalidRequest(detail string) *Error {
	return New(http.StatusBadRequest, CodeInvalidRequest, detail)
}

// Unauthorized reports a missing or invalid access token.
func Unauthorized() *Error {
	return New(http.StatusUnauthorized, CodeUnauthorized, "access token is missing or invalid")
}

// Forbidden reports an authenticated caller without the required permission.
func Forbidden() *Error {
	return New(http.StatusForbidden, CodeForbidden, "operation is not permitted")
}

// NotFound reports a missing resource with a resource-specific code.
func NotFound(code, detail string) *Error {
	return New(http.StatusNotFound, code, detail)
}

// Conflict reports an operation that contradicts the current state.
func Conflict(code, detail string) *Error {
	return New(http.StatusConflict, code, detail)
}

// Validation reports business-rule violations in a schema-valid request.
func Validation(fields ...FieldError) *Error {
	e := New(http.StatusUnprocessableEntity, CodeValidationFailed, "request violates validation rules")
	e.Fields = fields
	return e
}

// TooManyRequests reports an exceeded limit and tells the client when to retry.
func TooManyRequests(retryAfter time.Duration) *Error {
	e := New(http.StatusTooManyRequests, CodeRateLimited, "too many requests")
	e.RetryAfter = retryAfter
	return e
}

// NotImplemented marks a contract operation whose implementation is not
// written yet. It is an honest placeholder: clients get an explicit 501.
func NotImplemented() *Error {
	return New(http.StatusNotImplemented, CodeNotImplemented, "operation is defined in the contract but not implemented yet")
}

// Unavailable reports temporary overload or a missing dependency.
func Unavailable(retryAfter time.Duration) *Error {
	e := New(http.StatusServiceUnavailable, CodeUnavailable, "service is temporarily unavailable")
	e.RetryAfter = retryAfter
	return e
}

// Timeout reports a request that exceeded the server-side deadline.
func Timeout() *Error {
	return New(http.StatusGatewayTimeout, CodeTimeout, "request took too long")
}

// Internal hides an unexpected failure behind a generic 500.
func Internal() *Error {
	return New(http.StatusInternalServerError, CodeInternal, "internal error")
}

// FromError converts any error into an *Error. Errors that are not *Error
// become Internal; the boolean reports whether that happened, so the caller
// can log the original error.
func FromError(err error) (*Error, bool) {
	var e *Error
	if errors.As(err, &e) {
		return e, false
	}
	return Internal(), true
}

type body struct {
	Type      string       `json:"type"`
	Title     string       `json:"title"`
	Status    int          `json:"status"`
	Code      string       `json:"code"`
	Detail    string       `json:"detail,omitempty"`
	RequestID string       `json:"request_id,omitempty"`
	Errors    []FieldError `json:"errors,omitempty"`
}

// Write renders err as a problem response. The response never contains the
// text of an unexpected error.
func Write(w http.ResponseWriter, r *http.Request, err error) {
	e, _ := FromError(err)

	h := w.Header()
	h.Set("Content-Type", ContentType)
	h.Set("Cache-Control", "no-store")
	if e.RetryAfter > 0 {
		seconds := int((e.RetryAfter + time.Second - 1) / time.Second)
		h.Set("Retry-After", strconv.Itoa(seconds))
	}
	w.WriteHeader(e.Status)

	// The status line is already sent; an encoding failure can only mean the
	// client went away, so there is nothing useful left to do with it.
	_ = json.NewEncoder(w).Encode(body{
		Type:      "urn:sozhiteli:problem:" + e.Code,
		Title:     e.Title,
		Status:    e.Status,
		Code:      e.Code,
		Detail:    e.Detail,
		RequestID: logging.RequestID(r.Context()),
		Errors:    e.Fields,
	})
}

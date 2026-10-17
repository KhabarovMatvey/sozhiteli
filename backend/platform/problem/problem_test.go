package problem

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"sozhiteli.internal/platform/logging"
)

func TestWriteRendersProblemDocument(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(logging.WithRequestID(req.Context(), "req-42"))

	Write(rec, req, Validation(FieldError{Field: "budget_max_rub", Code: "out_of_range", Message: "too low"}))

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != ContentType {
		t.Errorf("Content-Type = %q", got)
	}

	var doc map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	if doc["code"] != CodeValidationFailed {
		t.Errorf("code = %v", doc["code"])
	}
	if doc["type"] != "urn:sozhiteli:problem:validation_failed" {
		t.Errorf("type = %v", doc["type"])
	}
	if doc["request_id"] != "req-42" {
		t.Errorf("request_id = %v", doc["request_id"])
	}
	if fields, _ := doc["errors"].([]any); len(fields) != 1 {
		t.Errorf("errors = %v", doc["errors"])
	}
}

func TestWriteHidesUnexpectedErrors(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)

	Write(rec, req, errors.New("password authentication failed for user profile_app"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", rec.Code)
	}
	var doc map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	if doc["detail"] != "internal error" {
		t.Errorf("internal detail leaked: %v", doc["detail"])
	}
}

func TestWriteSetsRetryAfter(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)

	Write(rec, req, TooManyRequests(1500*time.Millisecond))

	if got := rec.Header().Get("Retry-After"); got != "2" {
		t.Errorf("Retry-After = %q, want rounded up to 2", got)
	}
}

func TestFromErrorUnwraps(t *testing.T) {
	wrapped := fmt.Errorf("load profile: %w", NotFound("profile_not_found", "no profile"))

	e, unexpected := FromError(wrapped)

	if unexpected {
		t.Error("wrapped *Error reported as unexpected")
	}
	if e.Code != "profile_not_found" {
		t.Errorf("code = %q", e.Code)
	}
}

package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
)

func TestLoggerAddsServiceAndRequestID(t *testing.T) {
	var buf bytes.Buffer
	logger := New(&buf, "info", "profile")

	ctx := WithRequestID(context.Background(), "req-1")
	logger.InfoContext(ctx, "hello")

	var record map[string]any
	if err := json.Unmarshal(buf.Bytes(), &record); err != nil {
		t.Fatalf("log line is not JSON: %v", err)
	}
	if record["service"] != "profile" {
		t.Errorf("service = %v", record["service"])
	}
	if record["request_id"] != "req-1" {
		t.Errorf("request_id = %v", record["request_id"])
	}
}

func TestLoggerHonoursLevel(t *testing.T) {
	var buf bytes.Buffer
	logger := New(&buf, "warn", "profile")

	logger.Info("skipped")

	if buf.Len() != 0 {
		t.Errorf("info record written at warn level: %s", buf.String())
	}
}

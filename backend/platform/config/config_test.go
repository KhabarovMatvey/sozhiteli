package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoaderReadsTypedValues(t *testing.T) {
	l := NewLoaderFromMap(map[string]string{
		"NAME":    "profile",
		"COUNT":   "7",
		"TIMEOUT": "3s",
	})

	if got := l.RequiredString("NAME"); got != "profile" {
		t.Errorf("RequiredString = %q", got)
	}
	if got := l.Int("COUNT", 1); got != 7 {
		t.Errorf("Int = %d", got)
	}
	if got := l.Duration("TIMEOUT", time.Second); got != 3*time.Second {
		t.Errorf("Duration = %s", got)
	}
	if got := l.String("MISSING", "fallback"); got != "fallback" {
		t.Errorf("String default = %q", got)
	}
	if err := l.Err(); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestLoaderCollectsAllErrors(t *testing.T) {
	l := NewLoaderFromMap(map[string]string{"COUNT": "-1", "TIMEOUT": "soon"})

	l.RequiredString("NAME")
	l.Int("COUNT", 1)
	l.Duration("TIMEOUT", time.Second)

	err := l.Err()
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, key := range []string{"NAME", "COUNT", "TIMEOUT"} {
		if !strings.Contains(err.Error(), key) {
			t.Errorf("error %q does not mention %s", err, key)
		}
	}
}

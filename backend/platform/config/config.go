// Package config reads service configuration from environment variables.
//
// A Loader collects every problem it meets, so a misconfigured service reports
// all missing or malformed variables at once instead of failing one by one.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"
)

// Loader reads typed values from the environment.
type Loader struct {
	lookup func(string) (string, bool)
	errs   []error
}

// NewLoader returns a Loader backed by the process environment.
func NewLoader() *Loader {
	return &Loader{lookup: os.LookupEnv}
}

// NewLoaderFromMap returns a Loader backed by a fixed map. Intended for tests.
func NewLoaderFromMap(values map[string]string) *Loader {
	return &Loader{lookup: func(key string) (string, bool) {
		v, ok := values[key]
		return v, ok
	}}
}

// String returns the variable value or def when it is unset or empty.
func (l *Loader) String(key, def string) string {
	if v, ok := l.lookup(key); ok && v != "" {
		return v
	}
	return def
}

// RequiredString returns the variable value and records an error when it is
// unset or empty.
func (l *Loader) RequiredString(key string) string {
	v, ok := l.lookup(key)
	if !ok || v == "" {
		l.errs = append(l.errs, fmt.Errorf("%s is required", key))
		return ""
	}
	return v
}

// Int returns the variable parsed as a positive integer, or def when unset.
func (l *Loader) Int(key string, def int) int {
	v, ok := l.lookup(key)
	if !ok || v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		l.errs = append(l.errs, fmt.Errorf("%s must be a positive integer, got %q", key, v))
		return def
	}
	return n
}

// Duration returns the variable parsed with time.ParseDuration, or def when
// unset.
func (l *Loader) Duration(key string, def time.Duration) time.Duration {
	v, ok := l.lookup(key)
	if !ok || v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		l.errs = append(l.errs, fmt.Errorf("%s must be a positive duration like 5s, got %q", key, v))
		return def
	}
	return d
}

// Err returns every recorded problem joined into one error, or nil.
func (l *Loader) Err() error {
	return errors.Join(l.errs...)
}

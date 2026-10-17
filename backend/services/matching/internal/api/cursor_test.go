package api

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestFeedCursorRoundTrip(t *testing.T) {
	want := feedPosition{
		UpdatedAt: time.Date(2027, 7, 1, 12, 30, 45, 123456000, time.UTC),
		UserID:    uuid.MustParse("3f2b8c1e-6d4a-4e0b-9c7a-1a2b3c4d5e6f"),
	}

	got, err := decodeFeedCursor(encodeFeedCursor(want))

	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !got.UpdatedAt.Equal(want.UpdatedAt) || got.UserID != want.UserID {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestDecodeFeedCursorRejectsForeignValues(t *testing.T) {
	for _, cursor := range []string{"", "!!!", "bm90LWEtY3Vyc29y", "MjAyNy0wNy0wMXxub3QtYS11dWlk"} {
		if _, err := decodeFeedCursor(cursor); !errors.Is(err, errInvalidCursor) {
			t.Errorf("cursor %q: err = %v", cursor, err)
		}
	}
}

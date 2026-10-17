package changefeed

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

var (
	userA = uuid.MustParse("00000000-0000-4000-8000-00000000000a")
	userB = uuid.MustParse("00000000-0000-4000-8000-00000000000b")
	userC = uuid.MustParse("00000000-0000-4000-8000-00000000000c")
)

func TestCursorRoundTrip(t *testing.T) {
	want := Position{Version: 4242, UserID: userB}

	got, err := DecodeCursor(EncodeCursor(want))

	if err != nil {
		t.Fatalf("DecodeCursor: %v", err)
	}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestEmptyCursorIsStartOfFeed(t *testing.T) {
	got, err := DecodeCursor("")

	if err != nil {
		t.Fatalf("DecodeCursor: %v", err)
	}
	if got != (Position{}) {
		t.Errorf("got %+v, want zero position", got)
	}
}

func TestDecodeCursorRejectsForeignValues(t *testing.T) {
	for _, cursor := range []string{"!!!", "bm90LWEtY3Vyc29y", "LTE6MDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDBh"} {
		if _, err := DecodeCursor(cursor); !errors.Is(err, ErrInvalidCursor) {
			t.Errorf("cursor %q: err = %v, want ErrInvalidCursor", cursor, err)
		}
	}
}

func TestMergeOrdersAndLimits(t *testing.T) {
	changed := []Entry[string]{
		{Position: Position{Version: 10, UserID: userB}, Payload: "b@10"},
		{Position: Position{Version: 30, UserID: userA}, Payload: "a@30"},
	}
	deleted := []Entry[string]{
		{Position: Position{Version: 10, UserID: userA}, Deleted: true},
		{Position: Position{Version: 20, UserID: userC}, Deleted: true},
	}

	page := Merge(changed, deleted, 3)

	want := []Position{
		{Version: 10, UserID: userA},
		{Version: 10, UserID: userB},
		{Version: 20, UserID: userC},
	}
	if len(page) != len(want) {
		t.Fatalf("page has %d entries, want %d", len(page), len(want))
	}
	for i, p := range want {
		if page[i].Position != p {
			t.Errorf("entry %d = %+v, want %+v", i, page[i].Position, p)
		}
	}
}

func TestNextCursor(t *testing.T) {
	current := EncodeCursor(Position{Version: 5, UserID: userA})

	if got := NextCursor(current, []Entry[string]{}); got != current {
		t.Errorf("empty page moved the cursor: %q", got)
	}

	page := []Entry[string]{
		{Position: Position{Version: 6, UserID: userA}},
		{Position: Position{Version: 7, UserID: userC}},
	}
	want := EncodeCursor(Position{Version: 7, UserID: userC})
	if got := NextCursor(current, page); got != want {
		t.Errorf("cursor = %q, want %q", got, want)
	}
}

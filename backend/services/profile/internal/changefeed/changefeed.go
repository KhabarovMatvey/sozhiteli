// Package changefeed contains the pure logic of the profile change feed: the
// cursor format and the merge of changed and deleted profiles into one ordered
// page. The mechanism and its guarantees are described in README.md (section 4, ADR-0004).
package changefeed

import (
	"bytes"
	"cmp"
	"encoding/base64"
	"errors"
	"slices"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

// Position identifies a place in the feed. Entries are ordered by version and
// then by user identifier.
type Position struct {
	Version int64
	UserID  uuid.UUID
}

// ErrInvalidCursor reports a cursor that this service did not issue.
var ErrInvalidCursor = errors.New("invalid cursor")

// EncodeCursor turns a position into the opaque string given to consumers.
func EncodeCursor(p Position) string {
	raw := strconv.FormatInt(p.Version, 10) + ":" + p.UserID.String()
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// DecodeCursor parses a cursor. An empty cursor is the start of the feed.
func DecodeCursor(cursor string) (Position, error) {
	if cursor == "" {
		return Position{}, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return Position{}, ErrInvalidCursor
	}
	versionPart, userPart, found := strings.Cut(string(raw), ":")
	if !found {
		return Position{}, ErrInvalidCursor
	}
	version, err := strconv.ParseInt(versionPart, 10, 64)
	if err != nil || version < 0 {
		return Position{}, ErrInvalidCursor
	}
	userID, err := uuid.Parse(userPart)
	if err != nil {
		return Position{}, ErrInvalidCursor
	}
	return Position{Version: version, UserID: userID}, nil
}

// Entry is one feed item: either a changed profile carrying a payload or a
// deletion mark without one.
type Entry[T any] struct {
	Position Position
	Deleted  bool
	Payload  T
}

// compare orders positions exactly as PostgreSQL orders (bigint, uuid) rows:
// by version, then by the raw bytes of the identifier.
func compare(a, b Position) int {
	if c := cmp.Compare(a.Version, b.Version); c != 0 {
		return c
	}
	return bytes.Compare(a.UserID[:], b.UserID[:])
}

// Merge combines changed and deleted entries, each already limited to at most
// limit items after the same position, into one page of at most limit items in
// feed order. Items that do not fit are simply returned by the next request.
func Merge[T any](changed, deleted []Entry[T], limit int) []Entry[T] {
	page := make([]Entry[T], 0, len(changed)+len(deleted))
	page = append(page, changed...)
	page = append(page, deleted...)
	slices.SortFunc(page, func(a, b Entry[T]) int { return compare(a.Position, b.Position) })
	if len(page) > limit {
		page = page[:limit]
	}
	return page
}

// NextCursor returns the cursor a consumer must send to continue after page.
// For an empty page it is the cursor the consumer came with.
func NextCursor[T any](current string, page []Entry[T]) string {
	if len(page) == 0 {
		return current
	}
	return EncodeCursor(page[len(page)-1].Position)
}

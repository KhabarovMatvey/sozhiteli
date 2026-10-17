package api

import (
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

// listPosition is a place in a list of contact requests, which is ordered by
// created_at DESC, id DESC.
type listPosition struct {
	CreatedAt time.Time
	ID        uuid.UUID
}

// listStart is before the first page: every real position is "less" than it,
// so the list query is the same for every page and always uses its index.
var listStart = listPosition{
	CreatedAt: time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC),
	ID:        uuid.Max,
}

var errInvalidCursor = errors.New("invalid cursor")

func encodeListCursor(p listPosition) string {
	raw := p.CreatedAt.UTC().Format(time.RFC3339Nano) + "|" + p.ID.String()
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeListCursor(cursor string) (listPosition, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return listPosition{}, errInvalidCursor
	}
	timePart, idPart, found := strings.Cut(string(raw), "|")
	if !found {
		return listPosition{}, errInvalidCursor
	}
	createdAt, err := time.Parse(time.RFC3339Nano, timePart)
	if err != nil {
		return listPosition{}, errInvalidCursor
	}
	id, err := uuid.Parse(idPart)
	if err != nil {
		return listPosition{}, errInvalidCursor
	}
	return listPosition{CreatedAt: createdAt, ID: id}, nil
}

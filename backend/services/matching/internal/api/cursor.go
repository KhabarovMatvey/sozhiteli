package api

import (
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

// feedPosition is a place in the candidate feed, which is ordered by
// profile_updated_at DESC, user_id DESC.
type feedPosition struct {
	UpdatedAt time.Time
	UserID    uuid.UUID
}

// feedStart is before the first page: every real position is "less" than it.
// A fixed far-future value keeps the feed query identical for every page, so
// it always uses the same index.
var feedStart = feedPosition{
	UpdatedAt: time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC),
	UserID:    uuid.Max,
}

var errInvalidCursor = errors.New("invalid cursor")

func encodeFeedCursor(p feedPosition) string {
	raw := p.UpdatedAt.UTC().Format(time.RFC3339Nano) + "|" + p.UserID.String()
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeFeedCursor(cursor string) (feedPosition, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return feedPosition{}, errInvalidCursor
	}
	timePart, userPart, found := strings.Cut(string(raw), "|")
	if !found {
		return feedPosition{}, errInvalidCursor
	}
	updatedAt, err := time.Parse(time.RFC3339Nano, timePart)
	if err != nil {
		return feedPosition{}, errInvalidCursor
	}
	userID, err := uuid.Parse(userPart)
	if err != nil {
		return feedPosition{}, errInvalidCursor
	}
	return feedPosition{UpdatedAt: updatedAt, UserID: userID}, nil
}

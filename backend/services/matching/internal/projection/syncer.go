// Package projection keeps the Matching copy of profiles up to date.
//
// Matching never reads the Profile database and never calls Profile while
// serving a user request. Instead, a background Syncer polls the Profile
// change feed and applies it to the local candidate table (ADR-0004 in README.md).
// When Profile is unavailable the copy simply stops being refreshed; candidate
// search keeps working on the data already synchronised.
package projection

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"sozhiteli.internal/matching/internal/profileclient"
	"sozhiteli.internal/matching/internal/store"
)

const (
	sourceProfile = "profile"
	// stepTimeout bounds one poll-and-apply step, including the HTTP call.
	stepTimeout = 15 * time.Second
	// maxBackoff caps the pause between attempts while Profile is failing, so
	// that a struggling Profile is not hammered by retries.
	maxBackoff = time.Minute
)

// Config tunes the Syncer.
type Config struct {
	// Interval is the pause between polls when there is nothing new.
	Interval time.Duration
	// BatchSize is the number of changes requested per poll.
	BatchSize int
}

// Syncer applies the Profile change feed to the candidate projection.
type Syncer struct {
	client profileclient.ClientWithResponsesInterface
	pool   *pgxpool.Pool
	logger *slog.Logger
	cfg    Config
}

// NewSyncer returns a Syncer. The client must authenticate itself (service
// token) on its own.
func NewSyncer(client profileclient.ClientWithResponsesInterface, pool *pgxpool.Pool, logger *slog.Logger, cfg Config) *Syncer {
	return &Syncer{client: client, pool: pool, logger: logger, cfg: cfg}
}

// Run polls until ctx is cancelled. Failures are logged and retried with
// exponential backoff; they never stop the loop and never affect request
// handling.
func (s *Syncer) Run(ctx context.Context) {
	backoff := s.cfg.Interval
	for {
		applied, err := s.SyncOnce(ctx)

		var wait time.Duration
		switch {
		case ctx.Err() != nil:
			return
		case err != nil:
			s.logger.WarnContext(ctx, "profile sync failed", "error", err.Error(), "retry_in", backoff.String())
			wait = backoff
			backoff = min(backoff*2, maxBackoff)
		case applied == s.cfg.BatchSize:
			// A full page means more changes are waiting: continue at once.
			backoff = s.cfg.Interval
		default:
			wait = s.cfg.Interval
			backoff = s.cfg.Interval
		}

		// Jitter keeps several replicas from polling in lockstep. It is not a
		// security decision, so a non-cryptographic generator is fine.
		wait += time.Duration(rand.Int64N(int64(wait)/5 + 1)) //nolint:gosec // G404: timing jitter only
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

// SyncOnce fetches one page of changes and applies it together with the new
// cursor in a single transaction. It returns the number of applied changes.
//
// The step is safe to repeat and safe to run on several replicas at once:
// writes are idempotent and version-guarded, and the cursor moves with a
// compare-and-set, so a page is committed by exactly one replica.
func (s *Syncer) SyncOnce(ctx context.Context) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, stepTimeout)
	defer cancel()

	queries := store.New(s.pool)
	cursor, err := queries.GetSyncCursor(ctx, sourceProfile)
	if err != nil {
		return 0, fmt.Errorf("read sync cursor: %w", err)
	}

	limit := int32(s.cfg.BatchSize)
	params := &profileclient.ListProfileChangesParams{Limit: &limit}
	if cursor != "" {
		params.Cursor = &cursor
	}
	resp, err := s.client.ListProfileChangesWithResponse(ctx, params)
	if err != nil {
		return 0, fmt.Errorf("request profile changes: %w", err)
	}
	if resp.StatusCode() != http.StatusOK || resp.JSON200 == nil {
		return 0, fmt.Errorf("request profile changes: unexpected status %d", resp.StatusCode())
	}
	page := resp.JSON200
	if len(page.Items) == 0 {
		return 0, nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin transaction: %w", err)
	}
	// Rollback after a successful Commit is a no-op.
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	txQueries := queries.WithTx(tx)

	for _, item := range page.Items {
		if err := apply(ctx, txQueries, item); err != nil {
			return 0, err
		}
	}

	moved, err := txQueries.AdvanceSyncCursor(ctx, store.AdvanceSyncCursorParams{
		Source:    sourceProfile,
		OldCursor: cursor,
		NewCursor: page.NextCursor,
	})
	if err != nil {
		return 0, fmt.Errorf("advance sync cursor: %w", err)
	}
	if moved == 0 {
		// Another replica has already applied this page.
		return 0, nil
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit: %w", err)
	}
	return len(page.Items), nil
}

func apply(ctx context.Context, queries *store.Queries, item profileclient.ProfileChange) error {
	if item.Deleted {
		err := queries.DeleteCandidate(ctx, store.DeleteCandidateParams{
			UserID:        item.UserId,
			SourceVersion: item.Version,
		})
		if err != nil {
			return fmt.Errorf("delete candidate %s: %w", item.UserId, err)
		}
		return nil
	}

	p := item.Profile
	if p == nil {
		// A contract violation by Profile. Stopping here (the cursor does not
		// move) is deliberate: silently skipping would lose a profile.
		return errors.New("profile change without a snapshot")
	}
	habits, err := json.Marshal(p.Habits)
	if err != nil {
		return fmt.Errorf("encode habits of candidate %s: %w", item.UserId, err)
	}
	err = queries.UpsertCandidate(ctx, store.UpsertCandidateParams{
		UserID:               item.UserId,
		SourceVersion:        item.Version,
		DisplayName:          p.DisplayName,
		BirthYear:            int16(p.BirthYear),
		Gender:               string(p.Gender),
		Occupation:           p.Occupation,
		CityID:               int16(p.CityId),
		Districts:            p.Districts,
		BudgetMinRub:         p.BudgetMinRub,
		BudgetMaxRub:         p.BudgetMaxRub,
		MoveInFrom:           p.MoveInFrom.Time,
		MoveInTo:             p.MoveInTo.Time,
		RoommateGender:       string(p.RoommateGender),
		QuestionnaireVersion: p.QuestionnaireVersion,
		Habits:               habits,
		SearchStatus:         string(p.SearchStatus),
		ProfileUpdatedAt:     p.UpdatedAt,
		Scenario:             string(p.Scenario),
		AcceptsRoom:          p.AcceptsRoom,
		UtilitiesRub:         nullableInt(p.UtilitiesRub),
		DepositRub:           nullableInt(p.DepositRub),
		PlaceNote:            p.PlaceNote,
		RequiredHabits:       nonNil(p.RequiredHabits),
	})
	if err != nil {
		return fmt.Errorf("upsert candidate %s: %w", item.UserId, err)
	}
	return nil
}

func nullableInt(v *int32) pgtype.Int4 {
	if v == nil {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: *v, Valid: true}
}

func nonNil(codes []string) []string {
	if codes == nil {
		return []string{}
	}
	return codes
}

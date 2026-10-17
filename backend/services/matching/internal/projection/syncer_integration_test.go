//go:build integration

package projection_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"sozhiteli.internal/matching/internal/profileclient"
	"sozhiteli.internal/matching/internal/projection"
	"sozhiteli.internal/matching/migrations"
	"sozhiteli.internal/platform/migrate"
	"sozhiteli.internal/platform/postgres/pgtest"
)

// fakeProfile stands in for the Profile internal API. It serves pages keyed by
// the cursor the consumer sends, exactly like the real feed.
type fakeProfile struct {
	mu     sync.Mutex
	pages  map[string]profileclient.ProfileChangePage
	status int
	calls  int
}

func (f *fakeProfile) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++

	if f.status != 0 {
		w.WriteHeader(f.status)
		return
	}
	cursor := r.URL.Query().Get("cursor")
	page, ok := f.pages[cursor]
	if !ok {
		page = profileclient.ProfileChangePage{Items: []profileclient.ProfileChange{}, NextCursor: cursor}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(page)
}

func (f *fakeProfile) setPage(cursor string, page profileclient.ProfileChangePage) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.pages[cursor] = page
}

func (f *fakeProfile) setStatus(status int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.status = status
}

type fixture struct {
	t      *testing.T
	pool   *pgxpool.Pool
	fake   *fakeProfile
	syncer *projection.Syncer
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	ctx := context.Background()

	databaseURL := pgtest.NewDatabase(t)
	if _, err := migrate.Up(ctx, databaseURL, migrations.FS); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	fake := &fakeProfile{pages: map[string]profileclient.ProfileChangePage{}}
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)

	client, err := profileclient.NewClientWithResponses(srv.URL)
	if err != nil {
		t.Fatalf("client: %v", err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	syncer := projection.NewSyncer(client, pool, logger, projection.Config{
		Interval:  10 * time.Millisecond,
		BatchSize: 100,
	})
	return &fixture{t: t, pool: pool, fake: fake, syncer: syncer}
}

func change(id uuid.UUID, version int64, name string) profileclient.ProfileChange {
	day := func(s string) openapi_types.Date {
		d, _ := time.Parse(time.DateOnly, s)
		return openapi_types.Date{Time: d}
	}
	return profileclient.ProfileChange{
		UserId:  id,
		Version: version,
		Profile: &profileclient.ProfileSnapshot{
			DisplayName:          name,
			BirthYear:            2006,
			Gender:               "male",
			Occupation:           "студент",
			CityId:               1,
			Districts:            "центр",
			BudgetMinRub:         10000,
			BudgetMaxRub:         15000,
			MoveInFrom:           day("2027-08-20"),
			MoveInTo:             day("2027-09-01"),
			RoommateGender:       "any",
			QuestionnaireVersion: 1,
			Habits:               map[string]string{"smoking": "no"},
			SearchStatus:         "searching",
			UpdatedAt:            time.Date(2027, 7, 1, 12, 0, 0, 0, time.UTC),
		},
	}
}

func deletion(id uuid.UUID, version int64) profileclient.ProfileChange {
	return profileclient.ProfileChange{UserId: id, Version: version, Deleted: true}
}

func (f *fixture) candidateNames() map[uuid.UUID]string {
	f.t.Helper()
	rows, err := f.pool.Query(context.Background(), `SELECT user_id, display_name FROM candidate`)
	if err != nil {
		f.t.Fatalf("query candidates: %v", err)
	}
	defer rows.Close()
	out := map[uuid.UUID]string{}
	for rows.Next() {
		var id uuid.UUID
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			f.t.Fatalf("scan: %v", err)
		}
		out[id] = name
	}
	return out
}

func (f *fixture) cursor() string {
	f.t.Helper()
	var cursor string
	err := f.pool.QueryRow(context.Background(), `SELECT feed_cursor FROM sync_state WHERE source = 'profile'`).Scan(&cursor)
	if err != nil {
		f.t.Fatalf("read cursor: %v", err)
	}
	return cursor
}

func (f *fixture) syncOnce() int {
	f.t.Helper()
	n, err := f.syncer.SyncOnce(context.Background())
	if err != nil {
		f.t.Fatalf("SyncOnce: %v", err)
	}
	return n
}

func TestSyncAppliesChangesAndDeletionsAndMovesCursor(t *testing.T) {
	f := newFixture(t)
	kept, removed := uuid.New(), uuid.New()

	f.fake.setPage("", profileclient.ProfileChangePage{
		Items:      []profileclient.ProfileChange{change(kept, 10, "Останется"), change(removed, 11, "Уйдёт")},
		NextCursor: "c1",
	})
	if n := f.syncOnce(); n != 2 {
		t.Fatalf("applied %d changes, want 2", n)
	}
	if got := f.candidateNames(); len(got) != 2 || got[kept] != "Останется" {
		t.Fatalf("candidates after first page: %v", got)
	}
	if got := f.cursor(); got != "c1" {
		t.Fatalf("cursor = %q, want c1", got)
	}

	f.fake.setPage("c1", profileclient.ProfileChangePage{
		Items:      []profileclient.ProfileChange{change(kept, 20, "Обновлён"), deletion(removed, 21)},
		NextCursor: "c2",
	})
	f.syncOnce()

	got := f.candidateNames()
	if len(got) != 1 || got[kept] != "Обновлён" {
		t.Errorf("candidates after second page: %v", got)
	}
	if cursor := f.cursor(); cursor != "c2" {
		t.Errorf("cursor = %q, want c2", cursor)
	}

	if n := f.syncOnce(); n != 0 {
		t.Errorf("applied %d changes from an empty feed", n)
	}
	if cursor := f.cursor(); cursor != "c2" {
		t.Errorf("empty page moved the cursor to %q", cursor)
	}
}

// The feed is at-least-once: replaying a page, or receiving an older state
// after a newer one, must not corrupt the projection.
func TestSyncIsIdempotentAndIgnoresStaleVersions(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t)
	id := uuid.New()

	f.fake.setPage("", profileclient.ProfileChangePage{
		Items:      []profileclient.ProfileChange{change(id, 50, "Новая версия")},
		NextCursor: "c1",
	})
	f.syncOnce()

	// Rewind the cursor and replay an OLDER state and an OLDER deletion.
	if _, err := f.pool.Exec(ctx, `UPDATE sync_state SET feed_cursor = '' WHERE source = 'profile'`); err != nil {
		t.Fatalf("rewind cursor: %v", err)
	}
	f.fake.setPage("", profileclient.ProfileChangePage{
		Items:      []profileclient.ProfileChange{change(id, 40, "Старая версия"), deletion(id, 45)},
		NextCursor: "c1",
	})
	f.syncOnce()

	if got := f.candidateNames(); len(got) != 1 || got[id] != "Новая версия" {
		t.Errorf("stale data changed the projection: %v", got)
	}
}

// Failure model: while Profile is unavailable the projection and the cursor
// stay as they are, and synchronisation resumes by itself afterwards.
func TestSyncSurvivesProfileOutage(t *testing.T) {
	f := newFixture(t)
	id := uuid.New()
	f.fake.setPage("", profileclient.ProfileChangePage{
		Items:      []profileclient.ProfileChange{change(id, 10, "До сбоя")},
		NextCursor: "c1",
	})
	f.syncOnce()

	f.fake.setStatus(http.StatusServiceUnavailable)
	if _, err := f.syncer.SyncOnce(context.Background()); err == nil {
		t.Fatal("SyncOnce reported success while Profile answers 503")
	}
	if got := f.candidateNames(); got[id] != "До сбоя" {
		t.Errorf("projection changed during the outage: %v", got)
	}
	if cursor := f.cursor(); cursor != "c1" {
		t.Errorf("cursor moved during the outage: %q", cursor)
	}

	f.fake.setStatus(0)
	f.fake.setPage("c1", profileclient.ProfileChangePage{
		Items:      []profileclient.ProfileChange{change(id, 20, "После сбоя")},
		NextCursor: "c2",
	})
	f.syncOnce()
	if got := f.candidateNames(); got[id] != "После сбоя" {
		t.Errorf("sync did not resume: %v", got)
	}
}

func TestSyncStopsOnContractViolation(t *testing.T) {
	f := newFixture(t)
	valid := uuid.New()

	broken := profileclient.ProfileChange{UserId: uuid.New(), Version: 11} // neither deleted nor a snapshot
	f.fake.setPage("", profileclient.ProfileChangePage{
		Items:      []profileclient.ProfileChange{change(valid, 10, "Валидная"), broken},
		NextCursor: "c1",
	})

	if _, err := f.syncer.SyncOnce(context.Background()); err == nil {
		t.Fatal("SyncOnce accepted a change without a snapshot")
	}
	if got := f.candidateNames(); len(got) != 0 {
		t.Errorf("a partially applied page was committed: %v", got)
	}
	if cursor := f.cursor(); cursor != "" {
		t.Errorf("cursor moved past a broken page: %q", cursor)
	}
}

func TestRunStopsWhenContextIsCancelled(t *testing.T) {
	f := newFixture(t)
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		f.syncer.Run(ctx)
		close(done)
	}()

	time.Sleep(60 * time.Millisecond) // let it poll a few times
	cancel()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not stop after cancellation")
	}
	f.fake.mu.Lock()
	calls := f.fake.calls
	f.fake.mu.Unlock()
	if calls < 2 {
		t.Errorf("Run polled %d times, expected repeated polling", calls)
	}
}

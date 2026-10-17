//go:build integration

package internalapi_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"sozhiteli.internal/platform/auth"
	"sozhiteli.internal/platform/auth/authtest"
	"sozhiteli.internal/platform/migrate"
	"sozhiteli.internal/platform/openapi"
	"sozhiteli.internal/platform/openapi/openapitest"
	"sozhiteli.internal/platform/postgres/pgtest"
	"sozhiteli.internal/profile/internal/internalapi"
	"sozhiteli.internal/profile/internal/store"
	"sozhiteli.internal/profile/migrations"
)

const internalAudience = "sozhiteli-internal"

type feedFixture struct {
	t       *testing.T
	pool    *pgxpool.Pool
	handler http.Handler
	spec    *openapi3.T
	issuer  *authtest.Issuer
	token   string
}

func newFeedFixture(t *testing.T) *feedFixture {
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

	issuer := authtest.NewIssuer(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler, err := internalapi.NewHandler(logger,
		auth.NewVerifier(issuer.Config(internalAudience)),
		internalapi.NewServer(store.New(pool)))
	if err != nil {
		t.Fatalf("NewHandler: %v", err)
	}

	spec, err := internalapi.GetSpec()
	if err != nil {
		t.Fatalf("GetSpec: %v", err)
	}
	if err := openapi.Prepare(ctx, spec); err != nil {
		t.Fatalf("contract is invalid: %v", err)
	}

	return &feedFixture{
		t: t, pool: pool, handler: handler, spec: spec, issuer: issuer,
		token: issuer.Mint(authtest.Token{
			Subject:  uuid.NewString(),
			Audience: internalAudience,
			ClientID: "matching-service",
			Roles:    []string{internalapi.RoleReadProfileChanges},
		}),
	}
}

const insertProfileSQL = `
INSERT INTO profile (user_id, display_name, birth_year, gender, occupation, city_id, districts,
                     budget_min_rub, budget_max_rub, move_in_from, move_in_to, roommate_gender,
                     questionnaire_version, habits, search_status)
VALUES ($1, $2, 2006, 'male', 'студент', 1, 'центр',
        10000, 15000, '2027-08-20', '2027-09-01', 'any',
        1, '{"smoking":"no","guests":"with_notice"}', 'searching')`

func (f *feedFixture) insertProfile(name string) uuid.UUID {
	f.t.Helper()
	id := uuid.New()
	if _, err := f.pool.Exec(context.Background(), insertProfileSQL, id, name); err != nil {
		f.t.Fatalf("insert profile: %v", err)
	}
	return id
}

func (f *feedFixture) get(token, cursor string, limit int) (*http.Request, *httptest.ResponseRecorder) {
	query := url.Values{}
	if cursor != "" {
		query.Set("cursor", cursor)
	}
	if limit > 0 {
		query.Set("limit", strconv.Itoa(limit))
	}
	target := "/internal/v1/profile-changes"
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	return req, rec
}

// page waits until earlier writes are visible to the feed, then fetches one
// page and checks it against the contract.
func (f *feedFixture) page(cursor string, limit int) internalapi.ProfileChangePage {
	f.t.Helper()
	awaitFeedHorizon(f.t, f.pool)
	return f.pageNow(cursor, limit)
}

// pageNow fetches one page without waiting for the horizon.
func (f *feedFixture) pageNow(cursor string, limit int) internalapi.ProfileChangePage {
	f.t.Helper()
	req, rec := f.get(f.token, cursor, limit)
	if rec.Code != http.StatusOK {
		f.t.Fatalf("status = %d; body: %s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(f.t, f.spec, req, rec)

	var page internalapi.ProfileChangePage
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		f.t.Fatalf("decode page: %v", err)
	}
	return page
}

func ids(page internalapi.ProfileChangePage) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(page.Items))
	for _, item := range page.Items {
		out = append(out, item.UserId)
	}
	return out
}

func TestFeedDeliversChangesInOrderAndPages(t *testing.T) {
	f := newFeedFixture(t)
	first := f.insertProfile("Первый")
	second := f.insertProfile("Второй")
	third := f.insertProfile("Третий")

	page := f.page("", 2)
	if got := ids(page); len(got) != 2 || got[0] != first || got[1] != second {
		t.Fatalf("first page = %v, want [%s %s]", got, first, second)
	}
	if page.Items[0].Deleted || page.Items[0].Profile == nil {
		t.Fatalf("changed profile must carry a snapshot: %+v", page.Items[0])
	}
	if got := page.Items[0].Profile.Habits["guests"]; got != "with_notice" {
		t.Errorf("habits were not delivered: %v", page.Items[0].Profile.Habits)
	}
	if page.Items[0].Version >= page.Items[1].Version {
		t.Errorf("versions are not increasing: %d, %d", page.Items[0].Version, page.Items[1].Version)
	}

	rest := f.page(page.NextCursor, 2)
	if got := ids(rest); len(got) != 1 || got[0] != third {
		t.Fatalf("second page = %v, want [%s]", got, third)
	}

	empty := f.page(rest.NextCursor, 2)
	if len(empty.Items) != 0 {
		t.Errorf("feed returned %d items after the end", len(empty.Items))
	}
	if empty.NextCursor != rest.NextCursor {
		t.Errorf("empty page moved the cursor")
	}
}

func TestFeedRedeliversUpdatedAndDeletedProfiles(t *testing.T) {
	ctx := context.Background()
	f := newFeedFixture(t)
	updated := f.insertProfile("Изменится")
	removed := f.insertProfile("Удалится")
	cursor := f.page("", 0).NextCursor

	if _, err := f.pool.Exec(ctx, `UPDATE profile SET search_status = 'paused' WHERE user_id = $1`, updated); err != nil {
		t.Fatalf("update: %v", err)
	}
	if _, err := f.pool.Exec(ctx, `DELETE FROM profile WHERE user_id = $1`, removed); err != nil {
		t.Fatalf("delete: %v", err)
	}

	page := f.page(cursor, 0)
	if got := ids(page); len(got) != 2 || got[0] != updated || got[1] != removed {
		t.Fatalf("page = %v, want [%s %s]", got, updated, removed)
	}
	if page.Items[0].Profile == nil || page.Items[0].Profile.SearchStatus != "paused" {
		t.Errorf("updated profile snapshot = %+v", page.Items[0].Profile)
	}
	if !page.Items[1].Deleted || page.Items[1].Profile != nil {
		t.Errorf("deleted profile must be a bare deletion mark: %+v", page.Items[1])
	}

	// A profile created again under the same identifier replaces the mark.
	if _, err := f.pool.Exec(ctx, insertProfileSQL, removed, "Вернулся"); err != nil {
		t.Fatalf("re-insert: %v", err)
	}
	again := f.page(page.NextCursor, 0)
	if len(again.Items) != 1 || again.Items[0].Deleted || again.Items[0].UserId != removed {
		t.Errorf("re-created profile was not delivered as a change: %+v", again.Items)
	}
}

// The property the whole design rests on: a change committed by a transaction
// that started EARLIER but finished LATER must not be skipped. The feed holds
// back everything above the oldest open transaction until it finishes.
func TestFeedNeverSkipsChangesOfSlowTransactions(t *testing.T) {
	ctx := context.Background()
	f := newFeedFixture(t)

	slow, err := f.pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer slow.Rollback(ctx)
	slowID := uuid.New()
	if _, err := slow.Exec(ctx, insertProfileSQL, slowID, "Медленный"); err != nil {
		t.Fatalf("insert in slow transaction: %v", err)
	}

	fastID := f.insertProfile("Быстрый")

	held := f.pageNow("", 0)
	if len(held.Items) != 0 {
		t.Fatalf("feed exposed %v while an older transaction is still open", ids(held))
	}

	if err := slow.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	page := f.page(held.NextCursor, 0)
	if got := ids(page); len(got) != 2 || got[0] != slowID || got[1] != fastID {
		t.Fatalf("page = %v, want [%s %s]", got, slowID, fastID)
	}
}

func TestFeedRejectsCallersWithoutServiceRole(t *testing.T) {
	f := newFeedFixture(t)

	cases := map[string]struct {
		token string
		want  int
	}{
		"anonymous": {token: "", want: http.StatusUnauthorized},
		"end user token": {
			token: f.issuer.UserToken(uuid.NewString(), "sozhiteli-api"),
			want:  http.StatusUnauthorized,
		},
		"service without role": {
			token: f.issuer.Mint(authtest.Token{Subject: uuid.NewString(), Audience: internalAudience}),
			want:  http.StatusForbidden,
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			req, rec := f.get(tc.token, "", 0)

			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d", rec.Code, tc.want)
			}
			openapitest.AssertResponse(t, f.spec, req, rec)
		})
	}
}

func TestFeedRejectsInvalidParameters(t *testing.T) {
	f := newFeedFixture(t)

	for name, target := range map[string][2]string{
		"foreign cursor":  {"not-a-cursor", "0"},
		"limit too large": {"", "501"},
	} {
		t.Run(name, func(t *testing.T) {
			limit, _ := strconv.Atoi(target[1])
			req, rec := f.get(f.token, target[0], limit)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body: %s", rec.Code, rec.Body.String())
			}
			openapitest.AssertResponse(t, f.spec, req, rec)
		})
	}
}

// awaitFeedHorizon waits until every change already written to this database
// is below the feed horizon. The horizon is shared by the whole PostgreSQL
// server: a transaction of a test running in parallel elsewhere holds it back
// for a moment. The feed is late then, never lossy (docs/adr/0004), so a test
// that reads right after a write must wait for it instead of failing.
func awaitFeedHorizon(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	const query = `
SELECT pg_snapshot_xmin(pg_current_snapshot())::text::bigint >
       greatest((SELECT coalesce(max(feed_version), 0) FROM profile),
                (SELECT coalesce(max(feed_version), 0) FROM profile_deletion))`
	deadline := time.Now().Add(10 * time.Second)
	for {
		var caughtUp bool
		if err := pool.QueryRow(context.Background(), query).Scan(&caughtUp); err != nil {
			t.Fatalf("read feed horizon: %v", err)
		}
		if caughtUp {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("feed horizon did not pass the written changes within 10s")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

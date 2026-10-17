//go:build integration

package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"sozhiteli.internal/platform/migrate"
	"sozhiteli.internal/platform/openapi/openapitest"
	"sozhiteli.internal/platform/postgres/pgtest"
	"sozhiteli.internal/profile/internal/api"
	"sozhiteli.internal/profile/internal/internalapi"
	"sozhiteli.internal/profile/internal/questionnaire"
	"sozhiteli.internal/profile/internal/store"
	"sozhiteli.internal/profile/migrations"
)

// testCityID is Челябинск in migrations/00002_cities.sql. City identifiers
// are fixed forever, so the test may rely on it.
const testCityID = 1078

type dbFixture struct {
	fixture
	pool    *pgxpool.Pool
	queries *store.Queries
}

func newDBFixture(t *testing.T) dbFixture {
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
	queries := store.New(pool)
	return dbFixture{fixture: newFixture(t, queries), pool: pool, queries: queries}
}

// tokenFor returns a valid end-user token for another user of the same issuer.
func (f dbFixture) tokenFor(t *testing.T, subject string) string {
	t.Helper()
	return f.issuer.UserToken(subject, audience)
}

// validProfile returns a request body that satisfies every rule. Dates and the
// birth year are relative to today, so the test does not age.
func validProfile() map[string]any {
	now := time.Now().UTC()
	habits := map[string]string{}
	for _, q := range questionnaire.Current().Questions {
		habits[q.Code] = q.Options[0].Code
	}
	return map[string]any{
		"display_name":          "Дмитрий",
		"birth_year":            now.Year() - 19,
		"gender":                "male",
		"occupation":            "студент, 1 курс",
		"city_id":               testCityID,
		"districts":             "центр",
		"budget_min_rub":        10000,
		"budget_max_rub":        15000,
		"move_in_from":          now.AddDate(0, 0, 10).Format(time.DateOnly),
		"move_in_to":            now.AddDate(0, 1, 0).Format(time.DateOnly),
		"roommate_gender":       "any",
		"questionnaire_version": questionnaire.Current().Version,
		"habits":                habits,
		"search_status":         "searching",
	}
}

func encode(t *testing.T, body map[string]any) string {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("encode body: %v", err)
	}
	return string(raw)
}

func decodeProfile(t *testing.T, rec *httptest.ResponseRecorder) api.Profile {
	t.Helper()
	var p api.Profile
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("decode profile: %v; body: %s", err, rec.Body.String())
	}
	return p
}

type fieldErrors map[string]string

func decodeFieldErrors(t *testing.T, rec *httptest.ResponseRecorder) fieldErrors {
	t.Helper()
	var doc struct {
		Code   string `json:"code"`
		Errors []struct {
			Field string `json:"field"`
			Code  string `json:"code"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("decode problem: %v; body: %s", err, rec.Body.String())
	}
	if doc.Code != "validation_failed" {
		t.Fatalf("code = %q, want validation_failed", doc.Code)
	}
	out := fieldErrors{}
	for _, e := range doc.Errors {
		out[e.Field] = e.Code
	}
	return out
}

func TestImplementationStatusMatchesBehaviour(t *testing.T) {
	f := newDBFixture(t)
	openapitest.CheckImplementationStatus(t, f.spec, f.handler, f.token, nil)
}

func TestListCitiesReturnsAllRussianCitiesSortedByName(t *testing.T) {
	f := newDBFixture(t)

	req, rec := f.do(http.MethodGet, "/v1/cities", f.token, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body: %s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
	var list api.CityList
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(list.Items) != 1117 {
		t.Errorf("cities = %d, want 1117 from migrations/00002_cities.sql", len(list.Items))
	}

	position := map[string]int{}
	sovetskRegions := map[string]bool{}
	for i, c := range list.Items {
		position[c.Name+" / "+c.Region] = i
		if c.Name == "Советск" {
			sovetskRegions[c.Region] = true
		}
	}
	if _, ok := position["Челябинск / Челябинская область"]; !ok {
		t.Error("Челябинск is missing")
	}
	if len(sovetskRegions) != 3 {
		t.Errorf("namesake cities must be told apart by region, got %v", sovetskRegions)
	}
	// Russian alphabetical order by ICU rules, not byte order.
	elets, zhukovsky := position["Елец / Липецкая область"], position["Жуковский / Московская область"]
	if elets >= zhukovsky || position["Абакан / Республика Хакасия"] > elets {
		t.Errorf("cities are not in Russian alphabetical order")
	}
}

func TestGetMyProfileWithoutProfileIsNotFound(t *testing.T) {
	f := newDBFixture(t)

	req, rec := f.do(http.MethodGet, "/v1/me/profile", f.token, "")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if code := problemCode(t, rec); code != "profile_not_found" {
		t.Errorf("code = %q", code)
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
}

func TestPutCreatesThenReplacesProfile(t *testing.T) {
	f := newDBFixture(t)

	body := validProfile()
	body["display_name"] = "  Дмитрий  "
	req, rec := f.do(http.MethodPut, "/v1/me/profile", f.token, encode(t, body))
	if rec.Code != http.StatusOK {
		t.Fatalf("create: status = %d; body: %s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
	created := decodeProfile(t, rec)
	if created.UserId.String() != userID {
		t.Errorf("user_id = %s, want the token subject", created.UserId)
	}
	if created.DisplayName != "Дмитрий" {
		t.Errorf("display_name was not trimmed: %q", created.DisplayName)
	}

	body = validProfile()
	body["search_status"] = "paused"
	body["budget_max_rub"] = 20000
	_, rec = f.do(http.MethodPut, "/v1/me/profile", f.token, encode(t, body))
	if rec.Code != http.StatusOK {
		t.Fatalf("replace: status = %d; body: %s", rec.Code, rec.Body.String())
	}
	replaced := decodeProfile(t, rec)
	if replaced.SearchStatus != api.Paused || replaced.BudgetMaxRub != 20000 {
		t.Errorf("profile was not replaced: %+v", replaced)
	}
	if !replaced.CreatedAt.Equal(created.CreatedAt) {
		t.Errorf("created_at changed on replace: %s -> %s", created.CreatedAt, replaced.CreatedAt)
	}
	if replaced.UpdatedAt.Before(created.UpdatedAt) {
		t.Errorf("updated_at went back: %s -> %s", created.UpdatedAt, replaced.UpdatedAt)
	}

	req, rec = f.do(http.MethodGet, "/v1/me/profile", f.token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("get: status = %d", rec.Code)
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
	if got := decodeProfile(t, rec); got.SearchStatus != api.Paused || len(got.Habits) != len(questionnaire.Current().Questions) {
		t.Errorf("stored profile differs from the saved one: %+v", got)
	}
}

// Saving goes through the triggers, so the change reaches the change feed
// that Matching reads, without the handler knowing about it.
func TestSavedProfileAppearsInChangeFeed(t *testing.T) {
	f := newDBFixture(t)
	_, rec := f.do(http.MethodPut, "/v1/me/profile", f.token, encode(t, validProfile()))
	if rec.Code != http.StatusOK {
		t.Fatalf("save: status = %d; body: %s", rec.Code, rec.Body.String())
	}

	awaitFeedHorizon(t, f.pool)
	resp, err := internalapi.NewServer(f.queries).ListProfileChanges(context.Background(), internalapi.ListProfileChangesRequestObject{})
	if err != nil {
		t.Fatalf("ListProfileChanges: %v", err)
	}
	page, ok := resp.(internalapi.ListProfileChanges200JSONResponse)
	if !ok || len(page.Items) != 1 || page.Items[0].UserId.String() != userID || page.Items[0].Profile == nil {
		t.Fatalf("feed = %+v, want the saved profile", resp)
	}
}

func TestUsersSeeOnlyTheirOwnProfile(t *testing.T) {
	f := newDBFixture(t)
	if _, rec := f.do(http.MethodPut, "/v1/me/profile", f.token, encode(t, validProfile())); rec.Code != http.StatusOK {
		t.Fatalf("save: status = %d", rec.Code)
	}

	other := f.tokenFor(t, uuid.NewString())
	_, rec := f.do(http.MethodGet, "/v1/me/profile", other, "")

	if rec.Code != http.StatusNotFound {
		t.Errorf("another user got status %d for /v1/me/profile, want 404", rec.Code)
	}
}

func TestPutReportsEveryViolationAtOnce(t *testing.T) {
	f := newDBFixture(t)
	now := time.Now().UTC()

	body := validProfile()
	body["display_name"] = "Дима @dima_t"
	body["birth_year"] = now.Year() - 16
	body["city_id"] = 9999
	body["budget_min_rub"] = 20000
	body["budget_max_rub"] = 10000
	body["move_in_from"] = now.AddDate(0, 0, 20).Format(time.DateOnly)
	body["move_in_to"] = now.AddDate(0, 0, 5).Format(time.DateOnly)
	habits := body["habits"].(map[string]string)
	delete(habits, "guests")
	habits["smoking"] = "sometimes"

	req, rec := f.do(http.MethodPut, "/v1/me/profile", f.token, encode(t, body))

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422; body: %s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
	got := decodeFieldErrors(t, rec)
	want := fieldErrors{
		"display_name":   "contact_not_allowed",
		"birth_year":     "too_young",
		"city_id":        "unknown_city",
		"budget_max_rub": "less_than_min",
		"move_in_to":     "before_from",
		"habits.guests":  "required",
		"habits.smoking": "unknown_option",
	}
	for field, code := range want {
		if got[field] != code {
			t.Errorf("%s = %q, want %q", field, got[field], code)
		}
	}

	if _, rec := f.do(http.MethodGet, "/v1/me/profile", f.token, ""); rec.Code != http.StatusNotFound {
		t.Errorf("a rejected profile was stored: status %d", rec.Code)
	}
}

func TestPutRejectsCityOutsideDatabaseRange(t *testing.T) {
	f := newDBFixture(t)
	body := validProfile()
	body["city_id"] = 70000

	_, rec := f.do(http.MethodPut, "/v1/me/profile", f.token, encode(t, body))

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
	if got := decodeFieldErrors(t, rec)["city_id"]; got != "unknown_city" {
		t.Errorf("city_id = %q", got)
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

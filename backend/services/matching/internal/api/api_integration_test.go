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

	"sozhiteli.internal/matching/internal/api"
	"sozhiteli.internal/matching/internal/store"
	"sozhiteli.internal/matching/migrations"
	"sozhiteli.internal/platform/migrate"
	"sozhiteli.internal/platform/openapi/openapitest"
	"sozhiteli.internal/platform/postgres/pgtest"
)

type dbFixture struct {
	fixture
	pool *pgxpool.Pool
	// next is the profile_updated_at of the next inserted candidate: each one
	// is newer than the previous, so feed order is predictable.
	next time.Time
}

func newDBFixture(t *testing.T) *dbFixture {
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

	return &dbFixture{
		fixture: newFixture(t, store.New(pool)),
		pool:    pool,
		next:    time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC),
	}
}

// candidate is a projection row; zero fields get the defaults of newCandidate.
type candidate struct {
	id             uuid.UUID
	name           string
	gender         string
	roommateGender string
	cityID         int16
	budgetMin      int32
	budgetMax      int32
	moveInFrom     time.Time
	moveInTo       time.Time
	status         string
	habits         map[string]string
}

func newCandidate(name string) candidate {
	today := time.Now().UTC().Truncate(24 * time.Hour)
	return candidate{
		id:             uuid.New(),
		name:           name,
		gender:         "male",
		roommateGender: "any",
		cityID:         1,
		budgetMin:      10000,
		budgetMax:      15000,
		moveInFrom:     today.AddDate(0, 0, 10),
		moveInTo:       today.AddDate(0, 0, 40),
		status:         "searching",
		habits:         map[string]string{"smoking": "no", "guests": "with_notice", "sleep": "before_23"},
	}
}

func (f *dbFixture) insert(t *testing.T, c candidate) uuid.UUID {
	t.Helper()
	habits, err := json.Marshal(c.habits)
	if err != nil {
		t.Fatal(err)
	}
	f.next = f.next.Add(time.Minute)
	_, err = f.pool.Exec(context.Background(), `
INSERT INTO candidate (user_id, source_version, display_name, birth_year, gender, occupation, city_id,
                       districts, budget_min_rub, budget_max_rub, move_in_from, move_in_to,
                       roommate_gender, questionnaire_version, habits, search_status, profile_updated_at)
VALUES ($1, 1, $2, 2006, $3, 'студент', $4, 'центр', $5, $6, $7, $8, $9, 1, $10, $11, $12)`,
		c.id, c.name, c.gender, c.cityID, c.budgetMin, c.budgetMax, c.moveInFrom, c.moveInTo,
		c.roommateGender, habits, c.status, f.next)
	if err != nil {
		t.Fatalf("insert candidate %s: %v", c.name, err)
	}
	return c.id
}

// insertViewer adds the profile of the token owner.
func (f *dbFixture) insertViewer(t *testing.T, change func(*candidate)) {
	t.Helper()
	v := newCandidate("Зритель")
	v.id = uuid.MustParse(userID)
	if change != nil {
		change(&v)
	}
	f.insert(t, v)
}

func (f *dbFixture) views(t *testing.T) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(), `SELECT count(*) FROM candidate_view`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode: %v; body: %s", err, rec.Body.String())
	}
	return v
}

func names(cards []api.CandidateCard) []string {
	out := make([]string, 0, len(cards))
	for _, c := range cards {
		out = append(out, c.DisplayName)
	}
	return out
}

func TestImplementationStatusMatchesBehaviour(t *testing.T) {
	f := newDBFixture(t)
	openapitest.CheckImplementationStatus(t, f.spec, f.handler, f.token, nil)
}

func TestOperationsNeedTheViewersProfile(t *testing.T) {
	f := newDBFixture(t)

	for name, tc := range map[string][3]string{
		"feed":   {http.MethodGet, "/v1/candidates", ""},
		"card":   {http.MethodGet, "/v1/candidates/" + uuid.NewString(), ""},
		"lookup": {http.MethodPost, "/v1/candidates/lookup", `{"user_ids":["` + uuid.NewString() + `"]}`},
	} {
		t.Run(name, func(t *testing.T) {
			req, rec := f.do(tc[0], tc[1], tc[2])

			if rec.Code != http.StatusConflict || problemCode(t, rec) != "profile_not_ready" {
				t.Fatalf("status = %d body = %s, want 409 profile_not_ready", rec.Code, rec.Body.String())
			}
			if rec.Header().Get("Retry-After") == "" {
				t.Error("Retry-After is not set")
			}
			openapitest.AssertResponse(t, f.spec, req, rec)
		})
	}
}

func TestFeedAppliesEveryHardCondition(t *testing.T) {
	f := newDBFixture(t)
	f.insertViewer(t, nil)
	today := time.Now().UTC().Truncate(24 * time.Hour)

	f.insert(t, newCandidate("Подходит"))
	f.insert(t, func() candidate { c := newCandidate("Другой город"); c.cityID = 2; return c }())
	f.insert(t, func() candidate {
		c := newCandidate("Бюджет выше")
		c.budgetMin, c.budgetMax = 16000, 20000
		return c
	}())
	f.insert(t, func() candidate {
		c := newCandidate("Бюджет ниже")
		c.budgetMin, c.budgetMax = 5000, 9000
		return c
	}())
	f.insert(t, func() candidate {
		c := newCandidate("Позже")
		c.moveInFrom, c.moveInTo = today.AddDate(0, 2, 0), today.AddDate(0, 3, 0)
		return c
	}())
	f.insert(t, func() candidate { c := newCandidate("На паузе"); c.status = "paused"; return c }())
	f.insert(t, func() candidate {
		c := newCandidate("Хочет соседку")
		c.gender, c.roommateGender = "female", "same"
		return c
	}())
	f.insert(t, func() candidate {
		c := newCandidate("Девушка, всё равно")
		c.gender = "female"
		return c
	}())

	req, rec := f.do(http.MethodGet, "/v1/candidates", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body: %s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
	page := decode[api.CandidatePage](t, rec)
	got := names(page.Items)
	if len(got) != 2 || got[0] != "Девушка, всё равно" || got[1] != "Подходит" {
		t.Errorf("feed = %v, want [Девушка, всё равно, Подходит] (newest first, viewer excluded)", got)
	}
	if page.NextCursor != nil {
		t.Errorf("next_cursor = %q, want null on the last page", *page.NextCursor)
	}
}

func TestFeedRespectsViewersSameGenderPreference(t *testing.T) {
	f := newDBFixture(t)
	f.insertViewer(t, func(v *candidate) { v.roommateGender = "same" })
	f.insert(t, newCandidate("Парень"))
	f.insert(t, func() candidate { c := newCandidate("Девушка"); c.gender = "female"; return c }())

	_, rec := f.do(http.MethodGet, "/v1/candidates", "")

	if got := names(decode[api.CandidatePage](t, rec).Items); len(got) != 1 || got[0] != "Парень" {
		t.Errorf("feed = %v, want [Парень]", got)
	}
}

func TestFeedPagesWithoutGapsOrDuplicates(t *testing.T) {
	f := newDBFixture(t)
	f.insertViewer(t, nil)
	for _, name := range []string{"1", "2", "3", "4", "5"} {
		f.insert(t, newCandidate(name))
	}

	var seen []string
	cursor := ""
	for range 10 {
		url := "/v1/candidates?limit=2"
		if cursor != "" {
			url += "&cursor=" + cursor
		}
		req, rec := f.do(http.MethodGet, url, "")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d; body: %s", rec.Code, rec.Body.String())
		}
		openapitest.AssertResponse(t, f.spec, req, rec)
		page := decode[api.CandidatePage](t, rec)
		seen = append(seen, names(page.Items)...)
		if page.NextCursor == nil {
			break
		}
		cursor = *page.NextCursor
	}

	if got := len(seen); got != 5 || seen[0] != "5" || seen[4] != "1" {
		t.Errorf("pages = %v, want 5 4 3 2 1", seen)
	}
}

func TestFeedRejectsForeignCursor(t *testing.T) {
	f := newDBFixture(t)
	f.insertViewer(t, nil)

	req, rec := f.do(http.MethodGet, "/v1/candidates?cursor=not-a-cursor", "")

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
}

func TestCardsCountMatchingAnswers(t *testing.T) {
	f := newDBFixture(t)
	f.insertViewer(t, nil) // smoking=no, guests=with_notice, sleep=before_23
	c := newCandidate("Сосед")
	c.habits = map[string]string{"smoking": "no", "guests": "freely", "pets": "none"}
	f.insert(t, c)

	_, rec := f.do(http.MethodGet, "/v1/candidates", "")

	items := decode[api.CandidatePage](t, rec).Items
	if len(items) != 1 {
		t.Fatalf("feed = %v", names(items))
	}
	if got := items[0].Compatibility; got.MatchedCount != 1 || got.ComparedCount != 2 {
		t.Errorf("compatibility = %+v, want matched 1 of 2", got)
	}
	if want := int32(time.Now().Year() - 2006); items[0].Age != want {
		t.Errorf("age = %d, want %d", items[0].Age, want)
	}
}

func TestGetCandidateComparesAndRecordsTheView(t *testing.T) {
	f := newDBFixture(t)
	f.insertViewer(t, nil)
	c := newCandidate("Сосед")
	c.cityID = 2
	c.habits = map[string]string{"smoking": "no", "guests": "freely", "pets": "none"}
	id := f.insert(t, c)

	req, rec := f.do(http.MethodGet, "/v1/candidates/"+id.String(), "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body: %s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
	detail := decode[api.CandidateDetail](t, rec)
	if detail.Conditions.SameCity || !detail.Conditions.BudgetOverlap || !detail.Conditions.MoveInOverlap || !detail.Conditions.RoommateGenderOk {
		t.Errorf("conditions = %+v", detail.Conditions)
	}
	results := map[string]api.HabitComparisonResult{}
	for _, h := range detail.Habits {
		results[h.QuestionCode] = h.Result
	}
	want := map[string]api.HabitComparisonResult{
		"guests": api.Difference, "pets": api.NotComparable, "sleep": api.NotComparable, "smoking": api.Match,
	}
	for code, r := range want {
		if results[code] != r {
			t.Errorf("%s = %q, want %q", code, results[code], r)
		}
	}
	if len(detail.Habits) != len(want) || detail.Habits[0].QuestionCode != "guests" {
		t.Errorf("habits must list every answered question in code order: %+v", detail.Habits)
	}

	var matched, compared int
	err := f.pool.QueryRow(context.Background(),
		`SELECT matched_count, compared_count FROM candidate_view WHERE viewer_id = $1 AND candidate_id = $2`,
		uuid.MustParse(userID), id).Scan(&matched, &compared)
	if err != nil {
		t.Fatalf("view was not recorded: %v", err)
	}
	if matched != 1 || compared != 2 {
		t.Errorf("recorded view = %d of %d, want 1 of 2", matched, compared)
	}
}

func TestGetCandidateNotFound(t *testing.T) {
	f := newDBFixture(t)
	f.insertViewer(t, nil)

	for name, id := range map[string]string{"unknown": uuid.NewString(), "self": userID} {
		t.Run(name, func(t *testing.T) {
			req, rec := f.do(http.MethodGet, "/v1/candidates/"+id, "")

			if rec.Code != http.StatusNotFound || problemCode(t, rec) != "candidate_not_found" {
				t.Fatalf("status = %d body = %s, want 404 candidate_not_found", rec.Code, rec.Body.String())
			}
			openapitest.AssertResponse(t, f.spec, req, rec)
		})
	}
	if n := f.views(t); n != 0 {
		t.Errorf("failed lookups recorded %d views", n)
	}
}

func TestGetCandidateShowsPausedProfiles(t *testing.T) {
	f := newDBFixture(t)
	f.insertViewer(t, nil)
	c := newCandidate("На паузе")
	c.status = "paused"
	id := f.insert(t, c)

	_, rec := f.do(http.MethodGet, "/v1/candidates/"+id.String(), "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if got := decode[api.CandidateDetail](t, rec).Card.SearchStatus; got != api.Paused {
		t.Errorf("search_status = %q", got)
	}
}

func TestLookupReturnsKnownCardsInRequestOrder(t *testing.T) {
	f := newDBFixture(t)
	f.insertViewer(t, nil)
	first := f.insert(t, newCandidate("Первый"))
	other := newCandidate("Другой город")
	other.cityID = 9 // lookup does not apply the hard conditions
	second := f.insert(t, other)

	body := `{"user_ids":["` + second.String() + `","` + uuid.NewString() + `","` + userID + `","` + first.String() + `"]}`
	req, rec := f.do(http.MethodPost, "/v1/candidates/lookup", body)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body: %s", rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
	got := names(decode[api.CandidateList](t, rec).Items)
	if len(got) != 2 || got[0] != "Другой город" || got[1] != "Первый" {
		t.Errorf("lookup = %v, want [Другой город Первый]", got)
	}
	if n := f.views(t); n != 0 {
		t.Errorf("lookup recorded %d views; only opening a card counts", n)
	}
}

func TestFeedIsBuiltFromTheCallersOwnProfile(t *testing.T) {
	f := newDBFixture(t)
	f.insertViewer(t, nil)
	f.insert(t, newCandidate("Сосед"))

	other := f.issuer.UserToken(uuid.NewString(), audience)
	_, rec := f.doAs(other, http.MethodGet, "/v1/candidates", "")

	if rec.Code != http.StatusConflict {
		t.Errorf("a user without a profile got %d, want 409: the feed is built from the caller's own profile", rec.Code)
	}
}

func problemCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var doc struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("response is not a problem document: %v; body: %s", err, rec.Body.String())
	}
	return doc.Code
}

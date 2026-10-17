//go:build integration

package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"sozhiteli.internal/interaction/internal/api"
	"sozhiteli.internal/interaction/migrations"
	"sozhiteli.internal/platform/migrate"
	"sozhiteli.internal/platform/openapi/openapitest"
	"sozhiteli.internal/platform/postgres/pgtest"
)

// person is a test user with a valid token.
type person struct {
	id    string
	token string
}

type dbFixture struct {
	fixture
	pool *pgxpool.Pool
}

func newDBFixture(t *testing.T, dailyLimit int) dbFixture {
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
	return dbFixture{fixture: newFixture(t, pool, dailyLimit), pool: pool}
}

func (f dbFixture) person(t *testing.T) person {
	t.Helper()
	id := uuid.NewString()
	return person{id: id, token: f.issuer.UserToken(id, audience)}
}

// withContact returns a new person who has already set a Telegram contact.
func (f dbFixture) withContact(t *testing.T, telegram string) person {
	t.Helper()
	p := f.person(t)
	_, rec := f.doAs(p.token, http.MethodPut, "/v1/me/contact", `{"kind":"telegram","value":"`+telegram+`"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("set contact: status %d; body: %s", rec.Code, rec.Body.String())
	}
	return p
}

func (f dbFixture) send(t *testing.T, from, to person) *httptest.ResponseRecorder {
	t.Helper()
	req, rec := f.doAs(from.token, http.MethodPost, "/v1/contact-requests", `{"recipient_id":"`+to.id+`"}`)
	openapitest.AssertResponse(t, f.spec, req, rec)
	return rec
}

func (f dbFixture) list(t *testing.T, who person, query string) api.ContactRequestPage {
	t.Helper()
	req, rec := f.doAs(who.token, http.MethodGet, "/v1/contact-requests?"+query, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("list %s: status %d; body: %s", query, rec.Code, rec.Body.String())
	}
	openapitest.AssertResponse(t, f.spec, req, rec)
	return decode[api.ContactRequestPage](t, rec)
}

func (f dbFixture) answer(t *testing.T, who person, requestID, action string) *httptest.ResponseRecorder {
	t.Helper()
	req, rec := f.doAs(who.token, http.MethodPost, "/v1/contact-requests/"+requestID+"/"+action, "")
	openapitest.AssertResponse(t, f.spec, req, rec)
	return rec
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode: %v; body: %s", err, rec.Body.String())
	}
	return v
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

func expect(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, status, rec.Body.String())
	}
	if code != "" {
		if got := problemCode(t, rec); got != code {
			t.Fatalf("code = %q, want %q", got, code)
		}
	}
}

func TestImplementationStatusMatchesBehaviour(t *testing.T) {
	f := newDBFixture(t, 20)
	openapitest.CheckImplementationStatus(t, f.spec, f.handler, f.token, map[string]string{
		"listContactRequests": "direction=incoming",
	})
}

// --- I-01: own contact -------------------------------------------------------

func TestOwnContactLifecycle(t *testing.T) {
	f := newDBFixture(t, 20)
	me := f.person(t)

	req, rec := f.doAs(me.token, http.MethodGet, "/v1/me/contact", "")
	expect(t, rec, http.StatusNotFound, "contact_not_found")
	openapitest.AssertResponse(t, f.spec, req, rec)

	req, rec = f.doAs(me.token, http.MethodPut, "/v1/me/contact", `{"kind":"telegram","value":"dima_2006"}`)
	expect(t, rec, http.StatusOK, "")
	openapitest.AssertResponse(t, f.spec, req, rec)

	_, rec = f.doAs(me.token, http.MethodPut, "/v1/me/contact", `{"kind":"vk","value":"id12345"}`)
	expect(t, rec, http.StatusOK, "")

	req, rec = f.doAs(me.token, http.MethodGet, "/v1/me/contact", "")
	expect(t, rec, http.StatusOK, "")
	openapitest.AssertResponse(t, f.spec, req, rec)
	if got := decode[api.Contact](t, rec); got.Kind != api.Vk || got.Value != "id12345" {
		t.Errorf("contact = %+v, want the replacement", got)
	}

	other := f.person(t)
	_, rec = f.doAs(other.token, http.MethodGet, "/v1/me/contact", "")
	expect(t, rec, http.StatusNotFound, "contact_not_found")
}

func TestContactFormatIsChecked(t *testing.T) {
	f := newDBFixture(t, 20)

	req, rec := f.do(http.MethodPut, "/v1/me/contact", `{"kind":"telegram","value":"@dima_2006"}`)

	expect(t, rec, http.StatusUnprocessableEntity, "validation_failed")
	openapitest.AssertResponse(t, f.spec, req, rec)
}

// --- I-02: creating a request ------------------------------------------------

func TestCreateRequestRules(t *testing.T) {
	f := newDBFixture(t, 20)
	anna := f.withContact(t, "anna_ch")
	boris := f.withContact(t, "boris_ch")
	noContact := f.person(t)

	t.Run("sender without contact", func(t *testing.T) {
		expect(t, f.send(t, noContact, anna), http.StatusConflict, "contact_required")
	})
	t.Run("to yourself", func(t *testing.T) {
		expect(t, f.send(t, anna, anna), http.StatusUnprocessableEntity, "validation_failed")
	})
	t.Run("success hides the recipient contact", func(t *testing.T) {
		rec := f.send(t, anna, boris)
		expect(t, rec, http.StatusCreated, "")
		got := decode[api.ContactRequest](t, rec)
		if got.Status != api.Pending || got.Direction != api.Outgoing || got.CounterpartId.String() != boris.id {
			t.Errorf("request = %+v", got)
		}
		if got.CounterpartContact != nil || got.RespondedAt != nil {
			t.Errorf("pending request exposes %+v", got)
		}
	})
	t.Run("repeat", func(t *testing.T) {
		expect(t, f.send(t, anna, boris), http.StatusConflict, "request_exists")
	})
	t.Run("reverse", func(t *testing.T) {
		expect(t, f.send(t, boris, anna), http.StatusConflict, "reverse_request_exists")
	})
}

func TestDailyLimit(t *testing.T) {
	f := newDBFixture(t, 2)
	sender := f.withContact(t, "sender_ch")

	expect(t, f.send(t, sender, f.person(t)), http.StatusCreated, "")
	expect(t, f.send(t, sender, f.person(t)), http.StatusCreated, "")
	rec := f.send(t, sender, f.person(t))

	expect(t, rec, http.StatusTooManyRequests, "rate_limited")
	if rec.Header().Get("Retry-After") == "" {
		t.Error("Retry-After is not set")
	}
}

// Two people pressing the button at the same moment must not end up with two
// requests between them.
func TestConcurrentOppositeRequestsCreateOne(t *testing.T) {
	f := newDBFixture(t, 20)
	for range 10 {
		a := f.withContact(t, "aaaa_"+uuid.NewString()[:8])
		b := f.withContact(t, "bbbb_"+uuid.NewString()[:8])

		var wg sync.WaitGroup
		codes := make([]int, 2)
		for i, pair := range [][2]person{{a, b}, {b, a}} {
			wg.Go(func() {
				_, rec := f.doAs(pair[0].token, http.MethodPost, "/v1/contact-requests", `{"recipient_id":"`+pair[1].id+`"}`)
				codes[i] = rec.Code
			})
		}
		wg.Wait()

		created := 0
		for _, c := range codes {
			if c == http.StatusCreated {
				created++
			}
		}
		if created != 1 {
			t.Fatalf("concurrent opposite requests created %d (codes %v), want exactly 1", created, codes)
		}
	}
}

// --- I-03 and I-04: lists, answers and the reveal rule ------------------------

func TestContactIsRevealedOnlyAfterAcceptance(t *testing.T) {
	f := newDBFixture(t, 20)
	anna := f.withContact(t, "anna_ch")
	boris := f.withContact(t, "boris_ch")
	stranger := f.withContact(t, "stranger_ch")

	created := decode[api.ContactRequest](t, f.send(t, anna, boris))
	id := created.Id.String()

	for _, view := range []struct {
		who   person
		query string
	}{{anna, "direction=outgoing"}, {boris, "direction=incoming"}} {
		page := f.list(t, view.who, view.query)
		if len(page.Items) != 1 || page.Items[0].CounterpartContact != nil {
			t.Fatalf("pending request seen by %s reveals a contact: %+v", view.query, page.Items)
		}
	}

	// Only the recipient may answer; the sender and a stranger get the same 404.
	expect(t, f.answer(t, anna, id, "accept"), http.StatusNotFound, "contact_request_not_found")
	expect(t, f.answer(t, stranger, id, "accept"), http.StatusNotFound, "contact_request_not_found")

	rec := f.answer(t, boris, id, "accept")
	expect(t, rec, http.StatusOK, "")
	accepted := decode[api.ContactRequest](t, rec)
	if accepted.Status != api.Accepted || accepted.RespondedAt == nil ||
		accepted.CounterpartContact == nil || accepted.CounterpartContact.Value != "anna_ch" {
		t.Fatalf("accept response = %+v, want Anna's contact", accepted)
	}

	outgoing := f.list(t, anna, "direction=outgoing").Items
	if len(outgoing) != 1 || outgoing[0].CounterpartContact == nil || outgoing[0].CounterpartContact.Value != "boris_ch" {
		t.Errorf("sender does not see the recipient's contact after acceptance: %+v", outgoing)
	}
	incoming := f.list(t, boris, "direction=incoming").Items
	if len(incoming) != 1 || incoming[0].CounterpartContact == nil || incoming[0].CounterpartContact.Value != "anna_ch" {
		t.Errorf("recipient does not see the sender's contact: %+v", incoming)
	}

	for _, q := range []string{"direction=incoming", "direction=outgoing"} {
		if items := f.list(t, stranger, q).Items; len(items) != 0 {
			t.Errorf("a stranger sees other people's requests (%s): %+v", q, items)
		}
	}

	expect(t, f.answer(t, boris, id, "decline"), http.StatusConflict, "already_responded")
}

func TestDeclinedRequestRevealsNothing(t *testing.T) {
	f := newDBFixture(t, 20)
	anna := f.withContact(t, "anna_ch")
	boris := f.withContact(t, "boris_ch")
	id := decode[api.ContactRequest](t, f.send(t, anna, boris)).Id.String()

	rec := f.answer(t, boris, id, "decline")

	expect(t, rec, http.StatusOK, "")
	if got := decode[api.ContactRequest](t, rec); got.Status != api.Declined || got.CounterpartContact != nil {
		t.Errorf("decline response = %+v", got)
	}
	for _, v := range []struct {
		who   person
		query string
	}{{anna, "direction=outgoing"}, {boris, "direction=incoming"}} {
		items := f.list(t, v.who, v.query).Items
		if len(items) != 1 || items[0].Status != api.Declined || items[0].CounterpartContact != nil {
			t.Errorf("declined request seen via %s: %+v", v.query, items)
		}
	}
	expect(t, f.send(t, anna, boris), http.StatusConflict, "request_exists")
}

func TestAcceptRequiresOwnContact(t *testing.T) {
	f := newDBFixture(t, 20)
	anna := f.withContact(t, "anna_ch")
	noContact := f.person(t)
	id := decode[api.ContactRequest](t, f.send(t, anna, noContact)).Id.String()

	expect(t, f.answer(t, noContact, id, "accept"), http.StatusConflict, "contact_required")
	if items := f.list(t, noContact, "direction=incoming").Items; items[0].Status != api.Pending {
		t.Errorf("a failed accept changed the request: %+v", items[0])
	}
}

func TestListPagesAndFiltersByCounterpart(t *testing.T) {
	f := newDBFixture(t, 20)
	me := f.withContact(t, "me_chel")
	others := make([]person, 5)
	for i := range others {
		others[i] = f.withContact(t, "other_"+uuid.NewString()[:8])
		expect(t, f.send(t, me, others[i]), http.StatusCreated, "")
	}

	var seen []string
	cursor := ""
	for range 10 {
		q := "direction=outgoing&limit=2"
		if cursor != "" {
			q += "&cursor=" + cursor
		}
		page := f.list(t, me, q)
		for _, item := range page.Items {
			seen = append(seen, item.CounterpartId.String())
		}
		if page.NextCursor == nil {
			break
		}
		cursor = *page.NextCursor
	}
	if len(seen) != 5 || seen[0] != others[4].id || seen[4] != others[0].id {
		t.Errorf("pages = %v, want newest first without gaps or duplicates", seen)
	}

	filtered := f.list(t, me, "direction=outgoing&counterpart_id="+others[2].id).Items
	if len(filtered) != 1 || filtered[0].CounterpartId.String() != others[2].id {
		t.Errorf("counterpart filter = %+v", filtered)
	}

	_, rec := f.doAs(me.token, http.MethodGet, "/v1/contact-requests?direction=outgoing&cursor=not-a-cursor", "")
	expect(t, rec, http.StatusBadRequest, "invalid_request")
}

func TestAnswerUnknownRequest(t *testing.T) {
	f := newDBFixture(t, 20)

	expect(t, f.answer(t, f.withContact(t, "someone_x"), uuid.NewString(), "accept"), http.StatusNotFound, "contact_request_not_found")
}

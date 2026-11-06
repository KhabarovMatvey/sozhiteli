//go:build integration

package api_test

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"sozhiteli.internal/interaction/internal/api"
	"sozhiteli.internal/platform/auth/authtest"
	"sozhiteli.internal/platform/openapi/openapitest"
)

type httptestRecorder = httptest.ResponseRecorder

func (f dbFixture) block(t *testing.T, who, whom person) {
	t.Helper()
	req, rec := f.doAs(who.token, http.MethodPut, "/v1/blocks/"+whom.id, "")
	expect(t, rec, http.StatusNoContent, "")
	openapitest.AssertResponse(t, f.spec, req, rec)
}

func (f dbFixture) report(t *testing.T, who, whom person, body string) *httptestRecorder {
	t.Helper()
	if body == "" {
		body = `{"reported_id":"` + whom.id + `","reason":"commercial"}`
	}
	req, rec := f.doAs(who.token, http.MethodPost, "/v1/reports", body)
	openapitest.AssertResponse(t, f.spec, req, rec)
	return rec
}

func TestBlockForbidsRequestsInBothDirections(t *testing.T) {
	f := newDBFixture(t, 20)
	anna := f.withContact(t, "anna_ch")
	boris := f.withContact(t, "boris_ch")

	f.block(t, anna, boris)
	f.block(t, anna, boris) // idempotent

	expect(t, f.send(t, boris, anna), http.StatusConflict, "blocked")
	expect(t, f.send(t, anna, boris), http.StatusConflict, "blocked")

	req, rec := f.doAs(anna.token, http.MethodGet, "/v1/blocks", "")
	expect(t, rec, http.StatusOK, "")
	openapitest.AssertResponse(t, f.spec, req, rec)
	list := decode[api.BlockList](t, rec)
	if len(list.Items) != 1 || list.Items[0].UserId.String() != boris.id {
		t.Fatalf("blocks = %+v", list)
	}
	if other := decode[api.BlockList](t, func() *httptestRecorder {
		_, r := f.doAs(boris.token, http.MethodGet, "/v1/blocks", "")
		return r
	}()); len(other.Items) != 0 {
		t.Fatalf("the blocked person sees someone else's blocks: %+v", other)
	}

	req, rec = f.doAs(anna.token, http.MethodDelete, "/v1/blocks/"+boris.id, "")
	expect(t, rec, http.StatusNoContent, "")
	openapitest.AssertResponse(t, f.spec, req, rec)
	_, rec = f.doAs(anna.token, http.MethodDelete, "/v1/blocks/"+boris.id, "")
	expect(t, rec, http.StatusNoContent, "")
	expect(t, f.send(t, boris, anna), http.StatusCreated, "")
}

func TestBlockDeclinesPendingAndHidesRevealedContacts(t *testing.T) {
	f := newDBFixture(t, 20)
	anna := f.withContact(t, "anna_ch")
	boris := f.withContact(t, "boris_ch")
	vera := f.withContact(t, "vera_ch")

	pending := decode[api.ContactRequest](t, f.send(t, boris, anna)).Id.String()
	accepted := decode[api.ContactRequest](t, f.send(t, vera, anna)).Id.String()
	expect(t, f.answer(t, anna, accepted, "accept"), http.StatusOK, "")

	f.block(t, anna, boris)
	f.block(t, vera, anna) // blocked by the other side hides the contact too

	expect(t, f.answer(t, anna, pending, "accept"), http.StatusConflict, "already_responded")
	for _, item := range f.list(t, boris, "direction=outgoing").Items {
		if item.Status != api.Declined || item.CounterpartContact != nil {
			t.Fatalf("pending request survived the block: %+v", item)
		}
	}
	for _, view := range []struct {
		who   person
		query string
	}{{anna, "direction=incoming"}, {vera, "direction=outgoing"}} {
		for _, item := range f.list(t, view.who, view.query).Items {
			if item.CounterpartContact != nil {
				t.Fatalf("contact revealed despite a block (%s): %+v", view.query, item)
			}
		}
	}
}

func TestBlockValidation(t *testing.T) {
	f := newDBFixture(t, 20)
	me := f.person(t)
	_, rec := f.doAs(me.token, http.MethodPut, "/v1/blocks/"+me.id, "")
	expect(t, rec, http.StatusUnprocessableEntity, "validation_failed")
	_, rec = f.doAs(me.token, http.MethodPut, "/v1/blocks/not-a-uuid", "")
	expect(t, rec, http.StatusBadRequest, "invalid_request")
}

func TestReportRules(t *testing.T) {
	f := newDBFixture(t, 20)
	anna := f.person(t)
	boris := f.person(t)

	rec := f.report(t, anna, boris, "")
	expect(t, rec, http.StatusCreated, "")
	created := decode[api.Report](t, rec)
	if created.Status != api.Open || created.Reason != api.Commercial || created.ReportedId.String() != boris.id {
		t.Fatalf("report = %+v", created)
	}
	expect(t, f.report(t, anna, boris, ""), http.StatusConflict, "report_exists")
	expect(t, f.report(t, anna, anna, ""), http.StatusUnprocessableEntity, "validation_failed")
	expect(t, f.report(t, anna, boris, `{"reported_id":"`+f.person(t).id+`","reason":"other"}`), http.StatusUnprocessableEntity, "validation_failed")
	expect(t, f.report(t, anna, boris, `{"reported_id":"`+f.person(t).id+`","reason":"other","comment":"`+strings.Repeat("a", 501)+`"}`), http.StatusBadRequest, "invalid_request")
	expect(t, f.report(t, anna, boris, `{"reported_id":"`+f.person(t).id+`","reason":"spam"}`), http.StatusBadRequest, "invalid_request")

	// The daily limit counts every report, including the first one above.
	for i := 0; i < 9; i++ {
		expect(t, f.report(t, anna, f.person(t), ""), http.StatusCreated, "")
	}
	rec = f.report(t, anna, f.person(t), "")
	expect(t, rec, http.StatusTooManyRequests, "rate_limited")
	if rec.Header().Get("Retry-After") == "" {
		t.Error("Retry-After is missing")
	}
}

func TestAdminReviewsReports(t *testing.T) {
	f := newDBFixture(t, 20)
	admin := f.issuer.Mint(authtest.Token{Subject: userID, Audience: audience, Roles: []string{"sozhiteli-admin"}})
	target := f.person(t)
	first := decode[api.Report](t, f.report(t, f.person(t), target, `{"reported_id":"`+target.id+`","reason":"fraud","comment":"просит предоплату"}`))
	f.report(t, f.person(t), target, "")

	_, rec := f.doAs(target.token, http.MethodGet, "/v1/admin/reports", "")
	expect(t, rec, http.StatusForbidden, "forbidden")

	req, rec := f.doAs(admin, http.MethodGet, "/v1/admin/reports?limit=1", "")
	expect(t, rec, http.StatusOK, "")
	openapitest.AssertResponse(t, f.spec, req, rec)
	page := decode[api.AdminReportPage](t, rec)
	if len(page.Items) != 1 || page.NextCursor == nil || page.Items[0].Id != first.Id ||
		page.Items[0].Comment != "просит предоплату" || page.Items[0].ReportedOpenCount != 2 {
		t.Fatalf("first page = %+v", page)
	}
	_, rec = f.doAs(admin, http.MethodGet, "/v1/admin/reports?status=resolved&cursor="+url.QueryEscape(*page.NextCursor), "")
	expect(t, rec, http.StatusBadRequest, "invalid_request")

	req, rec = f.doAs(admin, http.MethodPost, "/v1/admin/reports/"+first.Id.String()+"/resolve", "")
	expect(t, rec, http.StatusOK, "")
	openapitest.AssertResponse(t, f.spec, req, rec)
	resolved := decode[api.AdminReport](t, rec)
	if resolved.Status != api.Resolved || resolved.ResolvedAt == nil || resolved.ReportedOpenCount != 1 {
		t.Fatalf("resolved = %+v", resolved)
	}
	_, rec = f.doAs(admin, http.MethodPost, "/v1/admin/reports/"+first.Id.String()+"/resolve", "")
	expect(t, rec, http.StatusConflict, "already_resolved")
	_, rec = f.doAs(admin, http.MethodPost, "/v1/admin/reports/"+f.person(t).id+"/resolve", "")
	expect(t, rec, http.StatusNotFound, "report_not_found")

	open := decode[api.AdminReportPage](t, func() *httptestRecorder {
		_, r := f.doAs(admin, http.MethodGet, "/v1/admin/reports", "")
		return r
	}())
	if len(open.Items) != 1 || open.Items[0].Id == first.Id {
		t.Fatalf("open queue = %+v", open)
	}
	resolvedPage := decode[api.AdminReportPage](t, func() *httptestRecorder {
		_, r := f.doAs(admin, http.MethodGet, "/v1/admin/reports?status=resolved", "")
		return r
	}())
	if len(resolvedPage.Items) != 1 || resolvedPage.Items[0].Id != first.Id {
		t.Fatalf("resolved queue = %+v", resolvedPage)
	}

	// The generic table view never shows the free-text comment.
	_, rec = f.doAs(admin, http.MethodGet, "/v1/admin/tables/report", "")
	expect(t, rec, http.StatusOK, "")
	if strings.Contains(rec.Body.String(), "предоплату") {
		t.Fatal("report comment leaked into the table view")
	}
	f.block(t, target, f.person(t))
	f.block(t, target, f.person(t))
	req, rec = f.doAs(admin, http.MethodGet, "/v1/admin/tables/user_block?limit=1", "")
	expect(t, rec, http.StatusOK, "")
	openapitest.AssertResponse(t, f.spec, req, rec)
	blocks := decode[api.AdminTableRows](t, rec)
	if len(blocks.Rows) != 1 || blocks.NextCursor == nil {
		t.Fatalf("blocks page = %+v", blocks)
	}
	_, rec = f.doAs(admin, http.MethodGet, "/v1/admin/tables/user_block?limit=1&cursor="+url.QueryEscape(*blocks.NextCursor), "")
	expect(t, rec, http.StatusOK, "")
	last := decode[api.AdminTableRows](t, rec)
	if len(last.Rows) != 1 || last.NextCursor != nil || last.Rows[0][0]+last.Rows[0][1] <= blocks.Rows[0][0]+blocks.Rows[0][1] {
		t.Fatalf("second blocks page = %+v", last)
	}
}

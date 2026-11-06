//go:build integration

package api_test

import (
	"net/http"
	"strings"
	"testing"

	"sozhiteli.internal/interaction/internal/api"
	"sozhiteli.internal/platform/openapi/openapitest"
)

func TestFavoritesArePrivateAndIdempotent(t *testing.T) {
	f := newDBFixture(t, 20)
	anna := f.person(t)
	boris := f.person(t)
	vera := f.person(t)

	for _, who := range []person{boris, vera, boris} {
		req, rec := f.doAs(anna.token, http.MethodPut, "/v1/favorites/"+who.id, "")
		expect(t, rec, http.StatusNoContent, "")
		openapitest.AssertResponse(t, f.spec, req, rec)
	}
	_, rec := f.doAs(anna.token, http.MethodPut, "/v1/favorites/"+anna.id, "")
	expect(t, rec, http.StatusUnprocessableEntity, "validation_failed")

	req, rec := f.doAs(anna.token, http.MethodGet, "/v1/favorites", "")
	expect(t, rec, http.StatusOK, "")
	openapitest.AssertResponse(t, f.spec, req, rec)
	list := decode[api.FavoriteList](t, rec)
	if len(list.Items) != 2 || list.Items[0].UserId.String() != vera.id {
		t.Fatalf("favorites = %+v, want vera first, then boris", list)
	}
	_, rec = f.doAs(boris.token, http.MethodGet, "/v1/favorites", "")
	if other := decode[api.FavoriteList](t, rec); len(other.Items) != 0 {
		t.Fatalf("someone else's favorites leaked: %+v", other)
	}

	_, rec = f.doAs(anna.token, http.MethodDelete, "/v1/favorites/"+vera.id, "")
	expect(t, rec, http.StatusNoContent, "")
	_, rec = f.doAs(anna.token, http.MethodGet, "/v1/favorites", "")
	if left := decode[api.FavoriteList](t, rec); len(left.Items) != 1 || left.Items[0].UserId.String() != boris.id {
		t.Fatalf("after delete = %+v", left)
	}
}

func TestAgreementIsSharedByAcceptedPair(t *testing.T) {
	f := newDBFixture(t, 20)
	anna := f.withContact(t, "anna_ch")
	boris := f.withContact(t, "boris_ch")
	stranger := f.withContact(t, "stranger_ch")
	id := decode[api.ContactRequest](t, f.send(t, anna, boris)).Id.String()
	path := "/v1/contact-requests/" + id + "/agreement"

	_, rec := f.doAs(anna.token, http.MethodGet, path, "")
	expect(t, rec, http.StatusConflict, "not_accepted")
	expect(t, f.answer(t, boris, id, "accept"), http.StatusOK, "")

	req, rec := f.doAs(anna.token, http.MethodGet, path, "")
	expect(t, rec, http.StatusOK, "")
	openapitest.AssertResponse(t, f.spec, req, rec)
	if empty := decode[api.Agreement](t, rec); empty.UpdatedAt != nil || empty.Items.Cleaning != nil {
		t.Fatalf("new agreement = %+v", empty)
	}

	req, rec = f.doAs(anna.token, http.MethodPut, path, `{"items":{"cleaning":"  по графику, по субботам ","guests":"   "}}`)
	expect(t, rec, http.StatusOK, "")
	openapitest.AssertResponse(t, f.spec, req, rec)

	req, rec = f.doAs(boris.token, http.MethodGet, path, "")
	expect(t, rec, http.StatusOK, "")
	openapitest.AssertResponse(t, f.spec, req, rec)
	seen := decode[api.Agreement](t, rec)
	if seen.Items.Cleaning == nil || *seen.Items.Cleaning != "по графику, по субботам" || seen.Items.Guests != nil ||
		seen.UpdatedByMe == nil || *seen.UpdatedByMe {
		t.Fatalf("boris sees %+v", seen)
	}

	_, rec = f.doAs(stranger.token, http.MethodGet, path, "")
	expect(t, rec, http.StatusNotFound, "contact_request_not_found")
	_, rec = f.doAs(anna.token, http.MethodPut, path, `{"items":{"pets":"нет"}}`)
	expect(t, rec, http.StatusBadRequest, "invalid_request")
	_, rec = f.doAs(anna.token, http.MethodPut, path, `{"items":{"other":"`+strings.Repeat("а", 301)+`"}}`)
	expect(t, rec, http.StatusBadRequest, "invalid_request")

	f.block(t, boris, anna)
	_, rec = f.doAs(anna.token, http.MethodGet, path, "")
	expect(t, rec, http.StatusConflict, "blocked")
}

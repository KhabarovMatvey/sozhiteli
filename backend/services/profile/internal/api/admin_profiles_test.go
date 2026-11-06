package api_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"sozhiteli.internal/platform/openapi/openapitest"
)

// adminProfileBody is a complete, valid profile. Validation happens before the
// role check, so only a valid body makes a 403 caused by the role visible.
func adminProfileBody(t *testing.T) string {
	t.Helper()
	body := map[string]any{
		"display_name": "Анна", "birth_year": 2000, "gender": "female", "occupation": "студент",
		"city_id": 1078, "districts": "", "budget_min_rub": 10000, "budget_max_rub": 15000,
		"move_in_from":    time.Now().AddDate(0, 0, 5).Format("2006-01-02"),
		"move_in_to":      time.Now().AddDate(0, 1, 5).Format("2006-01-02"),
		"roommate_gender": "any", "questionnaire_version": 1, "search_status": "searching",
		"habits": map[string]string{
			"smoking": "no", "pets": "none", "dishes": "same_day", "cleaning": "schedule",
			"guests": "with_notice", "sleep": "around_midnight", "shared_purchases": "split",
			"socializing": "neutral",
		},
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestAdminProfileOperationsRejectOrdinaryUsersBeforeDataAccess(t *testing.T) {
	f := newFixture(t, nil)
	profilePath := "/v1/admin/users/" + userID + "/profile"
	cases := []struct {
		method, target, body string
	}{
		{http.MethodGet, "/v1/admin/profiles", ""},
		{http.MethodGet, profilePath, ""},
		{http.MethodPut, profilePath, adminProfileBody(t)},
		{http.MethodDelete, profilePath, ""},
	}
	for _, tc := range cases {
		t.Run(tc.method+" "+tc.target, func(t *testing.T) {
			req, rec := f.do(tc.method, tc.target, f.token, tc.body)
			if rec.Code != http.StatusForbidden || problemCode(t, rec) != "forbidden" {
				t.Fatalf("ordinary user status=%d body=%s", rec.Code, rec.Body.String())
			}
			openapitest.AssertResponse(t, f.spec, req, rec)
			_, anonymous := f.do(tc.method, tc.target, "", tc.body)
			if anonymous.Code != http.StatusUnauthorized {
				t.Errorf("anonymous status=%d", anonymous.Code)
			}
		})
	}
}

func TestAdminProfileRequestsAreValidatedBeforeDatabase(t *testing.T) {
	f := newFixture(t, nil)
	token := adminToken(f)
	cases := []struct {
		method, target, body string
	}{
		{http.MethodGet, "/v1/admin/users/not-a-uuid/profile", ""},
		{http.MethodDelete, "/v1/admin/users/not-a-uuid/profile", ""},
		{http.MethodPut, "/v1/admin/users/not-a-uuid/profile", adminProfileBody(t)},
		{http.MethodPut, "/v1/admin/users/" + userID + "/profile", `{"display_name":"Анна"}`},
		{http.MethodPut, "/v1/admin/users/" + userID + "/profile", "not json"},
		{http.MethodGet, "/v1/admin/profiles?limit=0", ""},
		{http.MethodGet, "/v1/admin/profiles?limit=51", ""},
		{http.MethodGet, "/v1/admin/profiles?cursor=invalid", ""},
		{http.MethodGet, "/v1/admin/profiles?search=" + strings.Repeat("a", 129), ""},
	}
	for _, tc := range cases {
		t.Run(tc.method+" "+tc.target, func(t *testing.T) {
			req, rec := f.do(tc.method, tc.target, token, tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
			openapitest.AssertResponse(t, f.spec, req, rec)
		})
	}
}

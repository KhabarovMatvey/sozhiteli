package api

import (
	"encoding/json"
	"fmt"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"sozhiteli.internal/profile/internal/profilerules"
	"sozhiteli.internal/profile/internal/store"
)

// Database rows and API types are different types on purpose: a schema change
// must never silently change the API (README.md, section 6).

func profileFromRow(row store.Profile) (Profile, error) {
	habits := map[string]string{}
	if err := json.Unmarshal(row.Habits, &habits); err != nil {
		return Profile{}, fmt.Errorf("decode habits of profile %s: %w", row.UserID, err)
	}
	return Profile{
		UserId:               row.UserID,
		DisplayName:          row.DisplayName,
		BirthYear:            int32(row.BirthYear),
		Gender:               Gender(row.Gender),
		Occupation:           row.Occupation,
		CityId:               int32(row.CityID),
		Districts:            row.Districts,
		BudgetMinRub:         row.BudgetMinRub,
		BudgetMaxRub:         row.BudgetMaxRub,
		MoveInFrom:           openapi_types.Date{Time: row.MoveInFrom},
		MoveInTo:             openapi_types.Date{Time: row.MoveInTo},
		RoommateGender:       RoommateGender(row.RoommateGender),
		QuestionnaireVersion: row.QuestionnaireVersion,
		Habits:               habits,
		SearchStatus:         SearchStatus(row.SearchStatus),
		CreatedAt:            row.CreatedAt,
		UpdatedAt:            row.UpdatedAt,
	}, nil
}

func rulesInput(body ProfileInput) profilerules.Input {
	return profilerules.Input{
		DisplayName:          body.DisplayName,
		BirthYear:            body.BirthYear,
		Occupation:           body.Occupation,
		Districts:            body.Districts,
		BudgetMinRub:         body.BudgetMinRub,
		BudgetMaxRub:         body.BudgetMaxRub,
		MoveInFrom:           body.MoveInFrom.Time,
		MoveInTo:             body.MoveInTo.Time,
		QuestionnaireVersion: body.QuestionnaireVersion,
		Habits:               body.Habits,
	}
}

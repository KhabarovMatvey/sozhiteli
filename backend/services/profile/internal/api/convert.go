package api

import (
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
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
		Scenario:             Scenario(row.Scenario),
		AcceptsRoom:          row.AcceptsRoom,
		UtilitiesRub:         optionalInt(row.UtilitiesRub),
		DepositRub:           optionalInt(row.DepositRub),
		PlaceNote:            row.PlaceNote,
		RequiredHabits:       row.RequiredHabits,
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
		Scenario:             string(valueOr(body.Scenario, Pair)),
		AcceptsRoom:          valueOr(body.AcceptsRoom, false),
		UtilitiesRub:         body.UtilitiesRub,
		DepositRub:           body.DepositRub,
		PlaceNote:            valueOr(body.PlaceNote, ""),
		RequiredHabits:       valueOr(body.RequiredHabits, nil),
	}
}

func valueOr[T any](p *T, fallback T) T {
	if p == nil {
		return fallback
	}
	return *p
}

func optionalInt(v pgtype.Int4) *int32 {
	if !v.Valid {
		return nil
	}
	n := v.Int32
	return &n
}

func nullableInt(v *int32) pgtype.Int4 {
	if v == nil {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: *v, Valid: true}
}

package api

import (
	"encoding/json"
	"fmt"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"sozhiteli.internal/matching/internal/compare"
	"sozhiteli.internal/matching/internal/store"
)

// Database rows and API types are different types on purpose: a schema change
// must never silently change the API (docs/API_CONTRACTS.md).

// profile is a projection row with its answers decoded once.
type profile struct {
	row    store.Candidate
	habits map[string]string
}

func decodeProfile(row store.Candidate) (profile, error) {
	habits := map[string]string{}
	if err := json.Unmarshal(row.Habits, &habits); err != nil {
		return profile{}, fmt.Errorf("decode habits of candidate %s: %w", row.UserID, err)
	}
	return profile{row: row, habits: habits}, nil
}

func (p profile) conditions() compare.Conditions {
	return compare.Conditions{
		CityID:         p.row.CityID,
		Gender:         p.row.Gender,
		RoommateGender: p.row.RoommateGender,
		BudgetMinRub:   p.row.BudgetMinRub,
		BudgetMaxRub:   p.row.BudgetMaxRub,
		MoveInFrom:     p.row.MoveInFrom,
		MoveInTo:       p.row.MoveInTo,
	}
}

// card is the candidate as the viewer sees it in lists.
func card(viewer, candidate profile, now time.Time) CandidateCard {
	matched, compared := compare.Summary(viewer.habits, candidate.habits)
	row := candidate.row
	return CandidateCard{
		UserId:       row.UserID,
		DisplayName:  row.DisplayName,
		Age:          int32(now.Year()) - int32(row.BirthYear),
		Occupation:   row.Occupation,
		CityId:       int32(row.CityID),
		Districts:    row.Districts,
		BudgetMinRub: row.BudgetMinRub,
		BudgetMaxRub: row.BudgetMaxRub,
		MoveInFrom:   openapi_types.Date{Time: row.MoveInFrom},
		MoveInTo:     openapi_types.Date{Time: row.MoveInTo},
		SearchStatus: CandidateCardSearchStatus(row.SearchStatus),
		Compatibility: Compatibility{
			MatchedCount:  int32(matched),
			ComparedCount: int32(compared),
		},
	}
}

func habitComparisons(viewer, candidate profile) []HabitComparison {
	items := compare.CompareHabits(viewer.habits, candidate.habits)
	out := make([]HabitComparison, 0, len(items))
	for _, item := range items {
		hc := HabitComparison{QuestionCode: item.QuestionCode, Result: HabitComparisonResult(item.Result)}
		if item.Mine != "" {
			hc.MyOption = &item.Mine
		}
		if item.Theirs != "" {
			hc.TheirOption = &item.Theirs
		}
		out = append(out, hc)
	}
	return out
}

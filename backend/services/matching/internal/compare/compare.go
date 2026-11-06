// Package compare holds the comparison of two profiles: the hard conditions
// that decide whether a candidate is shown at all, and the household habits
// whose matches and differences are shown on the candidate card.
//
// Comparison is deliberately simple (ADR-0011 in README.md): two answers either have the
// same option code or not. There are no weights, scores or rankings.
package compare

import (
	"slices"
	"time"
)

// Habit comparison results. They are part of the API contract.
const (
	Match         = "match"
	Difference    = "difference"
	NotComparable = "not_comparable"
)

// Conditions are the hard conditions of one profile.
type Conditions struct {
	CityID         int16
	Gender         string
	RoommateGender string
	BudgetMinRub   int32
	BudgetMaxRub   int32
	MoveInFrom     time.Time
	MoveInTo       time.Time
	// Scenario is pair or room_offer; AcceptsRoom means a pair also wants
	// free places in rented flats.
	Scenario    string
	AcceptsRoom bool
	// Habits are the answers; Required are the question codes whose answer
	// must be the same.
	Habits   map[string]string
	Required []string
}

// Scenarios of a profile.
const (
	ScenarioPair      = "pair"
	ScenarioRoomOffer = "room_offer"
)

// ConditionsResult tells which hard conditions two profiles share.
type ConditionsResult struct {
	SameCity         bool
	BudgetOverlap    bool
	MoveInOverlap    bool
	RoommateGenderOK bool
	ScenarioOK       bool
	RequiredHabitsOK bool
}

// CompareConditions compares the viewer's hard conditions with a candidate's.
// The rules are the same as the filter of the candidate feed.
func CompareConditions(viewer, candidate Conditions) ConditionsResult {
	return ConditionsResult{
		SameCity:      viewer.CityID == candidate.CityID,
		BudgetOverlap: candidate.BudgetMinRub <= viewer.BudgetMaxRub && candidate.BudgetMaxRub >= viewer.BudgetMinRub,
		MoveInOverlap: !candidate.MoveInFrom.After(viewer.MoveInTo) && !candidate.MoveInTo.Before(viewer.MoveInFrom),
		RoommateGenderOK: (viewer.RoommateGender == "any" || candidate.Gender == viewer.Gender) &&
			(candidate.RoommateGender == "any" || candidate.Gender == viewer.Gender),
		ScenarioOK:       ScenariosCompatible(viewer, candidate),
		RequiredHabitsOK: requiredHold(viewer.Required, viewer.Habits, candidate.Habits) && requiredHold(candidate.Required, candidate.Habits, viewer.Habits),
	}
}

// ScenariosCompatible tells whether two profiles may meet: two people who rent
// together, or a free place and a person ready to move into a rented flat.
// Two free places never match.
func ScenariosCompatible(a, b Conditions) bool {
	switch {
	case a.Scenario == ScenarioPair && b.Scenario == ScenarioPair:
		return true
	case a.Scenario == ScenarioRoomOffer && b.Scenario == ScenarioPair:
		return b.AcceptsRoom
	case a.Scenario == ScenarioPair && b.Scenario == ScenarioRoomOffer:
		return a.AcceptsRoom
	default:
		return false
	}
}

// requiredHold reports whether every required question answered by both
// sides has the same answer. A question one side did not answer does not
// exclude anyone: the difference is unknown and can be discussed.
func requiredHold(required []string, owner, other map[string]string) bool {
	for _, code := range required {
		mine, ok1 := owner[code]
		theirs, ok2 := other[code]
		if ok1 && ok2 && mine != theirs {
			return false
		}
	}
	return true
}

// HabitItem is the comparison of one question.
type HabitItem struct {
	QuestionCode string
	// Mine and Theirs are empty when that side did not answer the question.
	Mine   string
	Theirs string
	Result string
}

// CompareHabits compares the answers of every question either side answered,
// ordered by question code.
func CompareHabits(mine, theirs map[string]string) []HabitItem {
	codes := make([]string, 0, len(mine)+len(theirs))
	for code := range mine {
		codes = append(codes, code)
	}
	for code := range theirs {
		if _, ok := mine[code]; !ok {
			codes = append(codes, code)
		}
	}
	slices.Sort(codes)

	items := make([]HabitItem, 0, len(codes))
	for _, code := range codes {
		my, iAnswered := mine[code]
		their, theyAnswered := theirs[code]
		item := HabitItem{QuestionCode: code, Mine: my, Theirs: their}
		switch {
		case !iAnswered || !theyAnswered:
			item.Result = NotComparable
		case my == their:
			item.Result = Match
		default:
			item.Result = Difference
		}
		items = append(items, item)
	}
	return items
}

// Summary counts the questions both sides answered and how many of them have
// the same answer.
func Summary(mine, theirs map[string]string) (matched, compared int) {
	for code, my := range mine {
		their, ok := theirs[code]
		if !ok {
			continue
		}
		compared++
		if my == their {
			matched++
		}
	}
	return matched, compared
}

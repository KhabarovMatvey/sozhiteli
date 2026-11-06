// Package profilerules holds the business rules a profile must satisfy before
// it is saved. The rules are pure functions: no HTTP, no
// database, no clock of their own, so every rule is unit-tested directly.
//
// Rules expressible in the OpenAPI contract (types, enums, raw lengths, value
// ranges) are enforced before the handler runs and are not repeated here.
package profilerules

import (
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"sozhiteli.internal/platform/problem"
	"sozhiteli.internal/profile/internal/questionnaire"
)

// Violation codes. They are part of the API contract: clients show field
// errors by these codes.
const (
	CodeOutOfRange         = "out_of_range"
	CodeContactNotAllowed  = "contact_not_allowed"
	CodeTooYoung           = "too_young"
	CodeLessThanMin        = "less_than_min"
	CodeBeforeFrom         = "before_from"
	CodeInPast             = "in_past"
	CodeUnsupportedVersion = "unsupported_version"
	CodeUnknownCity        = "unknown_city"
	CodeRequired           = "required"
	CodeSingleValue        = "single_value"
	CodeUnknownQuestion    = "unknown_question"
)

// Scenarios of a profile (priority Must #1).
const (
	ScenarioPair      = "pair"
	ScenarioRoomOffer = "room_offer"
)

const (
	minAge = 18
	maxAge = 100
)

// Input is a profile as submitted by its owner.
type Input struct {
	DisplayName          string
	BirthYear            int32
	Occupation           string
	Districts            string
	BudgetMinRub         int32
	BudgetMaxRub         int32
	MoveInFrom           time.Time
	MoveInTo             time.Time
	QuestionnaireVersion int32
	Habits               map[string]string
	Scenario             string
	AcceptsRoom          bool
	UtilitiesRub         *int32
	DepositRub           *int32
	PlaceNote            string
	RequiredHabits       []string
}

// Normalize trims the free-text fields. The trimmed values are both checked
// and stored.
func Normalize(in Input) Input {
	in.DisplayName = strings.TrimSpace(in.DisplayName)
	in.Occupation = strings.TrimSpace(in.Occupation)
	in.Districts = strings.TrimSpace(in.Districts)
	in.PlaceNote = strings.TrimSpace(in.PlaceNote)
	if in.Scenario == "" {
		in.Scenario = ScenarioPair
	}
	// Fields of the other scenario are dropped, not rejected: a client that
	// switches the scenario may still hold values typed for the previous one.
	if in.Scenario == ScenarioPair {
		in.UtilitiesRub, in.DepositRub, in.PlaceNote = nil, nil, ""
	} else {
		in.AcceptsRoom = false
	}
	if in.RequiredHabits == nil {
		in.RequiredHabits = []string{}
	}
	return in
}

type textField struct {
	name     string
	value    string
	min, max int
}

// Validate returns every rule the input violates, in a stable order. now is
// the current time; def is the questionnaire version answers must follow.
// The existence of the city is checked by the caller, which has the database.
func Validate(in Input, now time.Time, def questionnaire.Definition) []problem.FieldError {
	var errs []problem.FieldError
	add := func(field, code, message string) {
		errs = append(errs, problem.FieldError{Field: field, Code: code, Message: message})
	}

	for _, f := range []textField{
		{name: "display_name", value: in.DisplayName, min: 2, max: 40},
		{name: "occupation", value: in.Occupation, min: 2, max: 80},
		{name: "districts", value: in.Districts, min: 0, max: 200},
		{name: "place_note", value: in.PlaceNote, min: 0, max: 500},
	} {
		if n := utf8.RuneCountInString(f.value); n < f.min || n > f.max {
			add(f.name, CodeOutOfRange, fmt.Sprintf("%s must be %d to %d characters long after trimming", f.name, f.min, f.max))
		}
		if containsContact(f.value) {
			add(f.name, CodeContactNotAllowed, f.name+" must not contain contacts, links or phone numbers")
		}
	}

	switch age := int32(now.Year()) - in.BirthYear; {
	case age < minAge:
		add("birth_year", CodeTooYoung, fmt.Sprintf("the user must be at least %d years old", minAge))
	case age > maxAge:
		add("birth_year", CodeOutOfRange, fmt.Sprintf("age must not exceed %d years", maxAge))
	}

	if in.BudgetMaxRub < in.BudgetMinRub {
		add("budget_max_rub", CodeLessThanMin, "budget_max_rub must not be less than budget_min_rub")
	}
	if in.Scenario == ScenarioRoomOffer {
		// The rent of one place is a single price, not a range.
		if in.BudgetMaxRub != in.BudgetMinRub {
			add("budget_max_rub", CodeSingleValue, "for room_offer budget_min_rub and budget_max_rub are the rent of the place and must be equal")
		}
		if in.UtilitiesRub == nil {
			add("utilities_rub", CodeRequired, "utilities_rub is required for room_offer")
		}
		if in.DepositRub == nil {
			add("deposit_rub", CodeRequired, "deposit_rub is required for room_offer")
		}
	}

	if in.MoveInTo.Before(in.MoveInFrom) {
		add("move_in_to", CodeBeforeFrom, "move_in_to must not be earlier than move_in_from")
	}
	today := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	if in.MoveInTo.Before(today) {
		add("move_in_to", CodeInPast, "move_in_to must not be in the past")
	}

	if in.QuestionnaireVersion != def.Version {
		// Answers cannot be checked against a version the service does not
		// accept, so they are not reported separately.
		add("questionnaire_version", CodeUnsupportedVersion,
			fmt.Sprintf("only questionnaire version %d is accepted", def.Version))
		return errs
	}
	for _, v := range def.Check(in.Habits) {
		add("habits."+v.QuestionCode, v.Code, habitMessage(v.Code))
	}
	known := make(map[string]bool, len(def.Questions))
	for _, q := range def.Questions {
		known[q.Code] = true
	}
	for _, code := range in.RequiredHabits {
		if !known[code] {
			add("required_habits", CodeUnknownQuestion, "the questionnaire has no question "+code)
		}
	}
	return errs
}

func habitMessage(code string) string {
	switch code {
	case questionnaire.ViolationRequired:
		return "the question must be answered"
	case questionnaire.ViolationUnknownQuestion:
		return "the questionnaire has no such question"
	default:
		return "the question has no such option"
	}
}

var (
	contactMarkers  = []string{"@", "http", "www.", "t.me", "vk.com", "wa.me"}
	phoneSeparators = strings.NewReplacer(" ", "", "-", "", "(", "", ")", "")
	longDigitRun    = regexp.MustCompile(`[0-9]{7,}`)
)

// containsContact reports whether free text carries a way to reach the person
// directly. Such text would bypass the contact exchange, which only reveals a
// contact after mutual consent (README.md, section 7). It is a barrier against
// simple workarounds, not a guarantee.
func containsContact(text string) bool {
	lower := strings.ToLower(text)
	for _, marker := range contactMarkers {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return longDigitRun.MatchString(phoneSeparators.Replace(text))
}

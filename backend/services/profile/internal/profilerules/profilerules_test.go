package profilerules

import (
	"maps"
	"strings"
	"testing"
	"time"

	"sozhiteli.internal/platform/problem"
	"sozhiteli.internal/profile/internal/questionnaire"
)

var now = time.Date(2026, 10, 14, 15, 30, 0, 0, time.UTC)

func day(s string) time.Time {
	d, err := time.Parse(time.DateOnly, s)
	if err != nil {
		panic(err)
	}
	return d
}

func validInput() Input {
	def := questionnaire.Current()
	habits := map[string]string{}
	for _, q := range def.Questions {
		habits[q.Code] = q.Options[0].Code
	}
	return Input{
		DisplayName:          "Дмитрий",
		BirthYear:            2006,
		Occupation:           "студент, 1 курс",
		Districts:            "центр, рядом с университетом",
		BudgetMinRub:         10000,
		BudgetMaxRub:         15000,
		MoveInFrom:           day("2026-11-01"),
		MoveInTo:             day("2026-12-01"),
		QuestionnaireVersion: def.Version,
		Habits:               habits,
	}
}

func codes(errs []problem.FieldError) map[string]string {
	out := map[string]string{}
	for _, e := range errs {
		out[e.Field] = e.Code
	}
	return out
}

func TestValidInputPasses(t *testing.T) {
	if errs := Validate(validInput(), now, questionnaire.Current()); len(errs) != 0 {
		t.Errorf("valid input rejected: %v", errs)
	}
}

func TestEachRule(t *testing.T) {
	cases := map[string]struct {
		change    func(*Input)
		field     string
		code      string
		forbidden bool // the field must NOT be reported
	}{
		"name too short after trimming": {func(in *Input) { in.DisplayName = "Д" }, "display_name", CodeOutOfRange, false},
		"districts may be empty":        {func(in *Input) { in.Districts = "" }, "districts", "", true},
		"telegram handle in name":       {func(in *Input) { in.DisplayName = "Дима @dima" }, "display_name", CodeContactNotAllowed, false},
		"link in occupation":            {func(in *Input) { in.Occupation = "см. T.ME/dima" }, "occupation", CodeContactNotAllowed, false},
		"vk link in districts":          {func(in *Input) { in.Districts = "пишите vk.com/id1" }, "districts", CodeContactNotAllowed, false},
		"phone with separators":         {func(in *Input) { in.Districts = "8 (999) 123-45-67" }, "districts", CodeContactNotAllowed, false},
		"six digits are allowed":        {func(in *Input) { in.Districts = "индекс 454080" }, "districts", "", true},
		"seventeen years old":           {func(in *Input) { in.BirthYear = 2009 }, "birth_year", CodeTooYoung, false},
		"exactly eighteen this year":    {func(in *Input) { in.BirthYear = 2008 }, "birth_year", "", true},
		"older than one hundred":        {func(in *Input) { in.BirthYear = 1925 }, "birth_year", CodeOutOfRange, false},
		"budget max below min":          {func(in *Input) { in.BudgetMaxRub = 9000 }, "budget_max_rub", CodeLessThanMin, false},
		"budget max equal to min":       {func(in *Input) { in.BudgetMaxRub = in.BudgetMinRub }, "budget_max_rub", "", true},
		"move-in end before start":      {func(in *Input) { in.MoveInTo = day("2026-10-31") }, "move_in_to", CodeBeforeFrom, false},
		"move-in end in the past": {func(in *Input) {
			in.MoveInFrom, in.MoveInTo = day("2026-09-01"), day("2026-10-13")
		}, "move_in_to", CodeInPast, false},
		"move-in end today": {func(in *Input) {
			in.MoveInFrom, in.MoveInTo = day("2026-10-01"), day("2026-10-14")
		}, "move_in_to", "", true},
		"old questionnaire version": {func(in *Input) { in.QuestionnaireVersion = 0 }, "questionnaire_version", CodeUnsupportedVersion, false},
		"missing answer":            {func(in *Input) { delete(in.Habits, "guests") }, "habits.guests", questionnaire.ViolationRequired, false},
		"unknown option":            {func(in *Input) { in.Habits["guests"] = "always" }, "habits.guests", questionnaire.ViolationUnknownOption, false},
		"unknown question":          {func(in *Input) { in.Habits["zodiac"] = "leo" }, "habits.zodiac", questionnaire.ViolationUnknownQuestion, false},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			in := validInput()
			in.Habits = maps.Clone(in.Habits)
			tc.change(&in)

			got := codes(Validate(Normalize(in), now, questionnaire.Current()))

			if tc.forbidden {
				if code, ok := got[tc.field]; ok {
					t.Errorf("%s reported as %q, want no error", tc.field, code)
				}
				return
			}
			if got[tc.field] != tc.code {
				t.Errorf("%s = %q, want %q (all: %v)", tc.field, got[tc.field], tc.code, got)
			}
		})
	}
}

func TestAllViolationsAreReportedTogether(t *testing.T) {
	in := validInput()
	in.DisplayName = "x"
	in.BirthYear = 2015
	in.BudgetMaxRub = 1

	got := codes(Validate(in, now, questionnaire.Current()))

	for _, field := range []string{"display_name", "birth_year", "budget_max_rub"} {
		if _, ok := got[field]; !ok {
			t.Errorf("%s is not reported (all: %v)", field, got)
		}
	}
}

func TestUnsupportedVersionSkipsAnswerChecks(t *testing.T) {
	in := validInput()
	in.QuestionnaireVersion = 99
	in.Habits = map[string]string{}

	errs := Validate(in, now, questionnaire.Current())

	for _, e := range errs {
		if strings.HasPrefix(e.Field, "habits.") {
			t.Errorf("answers checked against an unsupported version: %v", e)
		}
	}
}

func TestNormalizeTrimsFreeText(t *testing.T) {
	in := Normalize(Input{DisplayName: "  Дмитрий ", Occupation: "\tстудент\n", Districts: "  "})

	if in.DisplayName != "Дмитрий" || in.Occupation != "студент" || in.Districts != "" {
		t.Errorf("not trimmed: %+v", in)
	}
}

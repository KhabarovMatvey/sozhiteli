package questionnaire

import (
	"regexp"
	"testing"
)

var codePattern = regexp.MustCompile(`^[a-z0-9_]{2,32}$`)

// The definition is data edited by hand; this test catches the mistakes that
// would silently corrupt comparisons: duplicate or malformed codes and
// questions without a real choice.
func TestCurrentDefinitionIsWellFormed(t *testing.T) {
	def := Current()

	if def.Version <= 0 {
		t.Errorf("version = %d", def.Version)
	}
	if len(def.Questions) == 0 {
		t.Fatal("definition has no questions")
	}

	questionCodes := map[string]bool{}
	for _, q := range def.Questions {
		if !codePattern.MatchString(q.Code) {
			t.Errorf("question code %q is malformed", q.Code)
		}
		if questionCodes[q.Code] {
			t.Errorf("question code %q is duplicated", q.Code)
		}
		questionCodes[q.Code] = true

		if q.Title == "" {
			t.Errorf("question %q has no title", q.Code)
		}
		if len(q.Options) < 2 {
			t.Errorf("question %q has fewer than two options", q.Code)
		}

		optionCodes := map[string]bool{}
		for _, o := range q.Options {
			if !codePattern.MatchString(o.Code) {
				t.Errorf("question %q: option code %q is malformed", q.Code, o.Code)
			}
			if optionCodes[o.Code] {
				t.Errorf("question %q: option code %q is duplicated", q.Code, o.Code)
			}
			optionCodes[o.Code] = true
			if o.Label == "" {
				t.Errorf("question %q: option %q has no label", q.Code, o.Code)
			}
		}
	}
}

func TestCheckAcceptsCompleteAnswers(t *testing.T) {
	def := Current()
	answers := map[string]string{}
	for _, q := range def.Questions {
		answers[q.Code] = q.Options[0].Code
	}

	if got := def.Check(answers); len(got) != 0 {
		t.Errorf("complete answers rejected: %v", got)
	}
}

func TestCheckReportsEveryProblemInStableOrder(t *testing.T) {
	def := Definition{Version: 1, Questions: []Question{
		{Code: "smoking", Options: []Option{{Code: "no"}, {Code: "yes"}}},
		{Code: "guests", Options: []Option{{Code: "none"}, {Code: "freely"}}},
		{Code: "pets", Options: []Option{{Code: "none"}, {Code: "have"}}},
	}}
	answers := map[string]string{
		"smoking": "sometimes", // unknown option
		"pets":    "none",      // fine; "guests" is missing
		"zodiac":  "leo",       // unknown question
		"alcohol": "no",        // unknown question
	}

	got := def.Check(answers)

	want := []Violation{
		{QuestionCode: "smoking", Code: ViolationUnknownOption},
		{QuestionCode: "guests", Code: ViolationRequired},
		{QuestionCode: "alcohol", Code: ViolationUnknownQuestion},
		{QuestionCode: "zodiac", Code: ViolationUnknownQuestion},
	}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("violation %d = %v, want %v", i, got[i], want[i])
		}
	}
}

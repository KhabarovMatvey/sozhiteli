// Package questionnaire holds the definition of the household habits
// questionnaire.
//
// The definition is product content, not code structure: every question exists
// because the interviews showed a matching disagreement or a question people
// had to ask each candidate again. The evidence for each question is recorded
// in docs/FEATURE_JUSTIFICATION.md (section "Анкета бытовых привычек") and
// referenced below by its evidence code.
//
// Changing the definition:
//   - adding, removing or rewording a question or an option creates a NEW
//     version: add a new Definition and switch Current to it; never edit a
//     published version, because stored answers refer to it;
//   - codes are part of the API contract (clients and Matching compare them),
//     labels are not.
package questionnaire

import "slices"

// Option is one possible answer.
type Option struct {
	Code  string
	Label string
}

// Question is one question with a fixed set of answers.
type Question struct {
	Code    string
	Title   string
	Options []Option
}

// Definition is one immutable version of the questionnaire.
type Definition struct {
	Version   int32
	Questions []Question
}

// Current returns the version new and edited profiles must use.
func Current() Definition {
	return v1
}

var v1 = Definition{
	Version: 1,
	Questions: []Question{
		{
			// Evidence: E-HAB-SMOKING.
			Code:  "smoking",
			Title: "Курение",
			Options: []Option{
				{Code: "no", Label: "Не курю"},
				{Code: "outside", Label: "Курю, но не в квартире"},
				{Code: "at_home", Label: "Курю дома или на балконе"},
			},
		},
		{
			// Evidence: E-HAB-PETS.
			Code:  "pets",
			Title: "Домашние животные",
			Options: []Option{
				{Code: "none", Label: "Животных нет и заводить не планирую"},
				{Code: "have", Label: "Есть животное или планирую завести"},
			},
		},
		{
			// Evidence: E-HAB-DISHES.
			Code:  "dishes",
			Title: "Когда мою посуду",
			Options: []Option{
				{Code: "right_away", Label: "Сразу после еды"},
				{Code: "same_day", Label: "В течение дня"},
				{Code: "when_piles_up", Label: "Когда накопится"},
			},
		},
		{
			// Evidence: E-HAB-CLEANING.
			Code:  "cleaning",
			Title: "Уборка общих зон",
			Options: []Option{
				{Code: "schedule", Label: "По очереди, по договорённому графику"},
				{Code: "as_needed", Label: "Без графика, по мере загрязнения"},
			},
		},
		{
			// Evidence: E-HAB-GUESTS.
			Code:  "guests",
			Title: "Гости",
			Options: []Option{
				{Code: "none", Label: "Гостей не привожу"},
				{Code: "with_notice", Label: "Привожу, предупреждая заранее"},
				{Code: "freely", Label: "Могу привести без предупреждения"},
			},
		},
		{
			// Evidence: E-HAB-SLEEP.
			Code:  "sleep",
			Title: "Когда обычно ложусь спать",
			Options: []Option{
				{Code: "before_23", Label: "До 23:00"},
				{Code: "around_midnight", Label: "С 23:00 до 01:00"},
				{Code: "after_1", Label: "После 01:00"},
			},
		},
		{
			// Evidence: E-HAB-PURCHASES.
			Code:  "shared_purchases",
			Title: "Бытовые расходники: средства для уборки, губки, бумага",
			Options: []Option{
				{Code: "split", Label: "Покупаем общие и делим расходы пополам"},
				{Code: "separate", Label: "Каждый покупает себе"},
			},
		},
		{
			// Evidence: E-HAB-SOCIAL.
			Code:  "socializing",
			Title: "Чего жду от общения с соседом",
			Options: []Option{
				{Code: "friends", Label: "Хочу дружить и проводить время вместе"},
				{Code: "neutral", Label: "Доброжелательное соседство без обязательств"},
				{Code: "minimal", Label: "Минимум общения, у каждого своя жизнь"},
			},
		},
	},
}

// Violation is one problem with a set of answers.
type Violation struct {
	// QuestionCode is the question the problem is about.
	QuestionCode string
	// Code is required, unknown_question or unknown_option.
	Code string
}

// Violation codes returned by Check.
const (
	ViolationRequired        = "required"
	ViolationUnknownQuestion = "unknown_question"
	ViolationUnknownOption   = "unknown_option"
)

// Check reports every way answers differ from this version: a question
// without an answer, an answer to a question that does not exist, an option
// the question does not have. Violations come in a stable order: questions of
// the definition first, in definition order, then unknown questions sorted
// by code.
func (d Definition) Check(answers map[string]string) []Violation {
	var violations []Violation
	known := make(map[string]bool, len(d.Questions))
	for _, q := range d.Questions {
		known[q.Code] = true
		answer, ok := answers[q.Code]
		if !ok {
			violations = append(violations, Violation{QuestionCode: q.Code, Code: ViolationRequired})
			continue
		}
		if !q.hasOption(answer) {
			violations = append(violations, Violation{QuestionCode: q.Code, Code: ViolationUnknownOption})
		}
	}

	var unknown []string
	for code := range answers {
		if !known[code] {
			unknown = append(unknown, code)
		}
	}
	slices.Sort(unknown)
	for _, code := range unknown {
		violations = append(violations, Violation{QuestionCode: code, Code: ViolationUnknownQuestion})
	}
	return violations
}

func (q Question) hasOption(code string) bool {
	for _, o := range q.Options {
		if o.Code == code {
			return true
		}
	}
	return false
}

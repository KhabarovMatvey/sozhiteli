package compare

import (
	"testing"
	"time"
)

func day(s string) time.Time {
	d, err := time.Parse(time.DateOnly, s)
	if err != nil {
		panic(err)
	}
	return d
}

func viewer() Conditions {
	return Conditions{
		CityID: 1, Gender: "male", RoommateGender: "any",
		BudgetMinRub: 10000, BudgetMaxRub: 15000,
		MoveInFrom: day("2027-08-20"), MoveInTo: day("2027-09-01"),
		Scenario: ScenarioPair,
		Habits:   map[string]string{"smoking": "no", "noise": "quiet"},
	}
}

func TestCompareConditions(t *testing.T) {
	cases := map[string]struct {
		change func(v, c *Conditions)
		want   ConditionsResult
	}{
		"identical": {func(*Conditions, *Conditions) {}, ConditionsResult{true, true, true, true, true, true}},
		"other city": {func(_ *Conditions, c *Conditions) { c.CityID = 2 },
			ConditionsResult{false, true, true, true, true, true}},
		"budget touches at the edge": {func(_ *Conditions, c *Conditions) { c.BudgetMinRub, c.BudgetMaxRub = 15000, 20000 },
			ConditionsResult{true, true, true, true, true, true}},
		"budget above": {func(_ *Conditions, c *Conditions) { c.BudgetMinRub, c.BudgetMaxRub = 15001, 20000 },
			ConditionsResult{true, false, true, true, true, true}},
		"budget below": {func(_ *Conditions, c *Conditions) { c.BudgetMinRub, c.BudgetMaxRub = 5000, 9999 },
			ConditionsResult{true, false, true, true, true, true}},
		"dates touch at the edge": {func(_ *Conditions, c *Conditions) { c.MoveInFrom, c.MoveInTo = day("2027-09-01"), day("2027-10-01") },
			ConditionsResult{true, true, true, true, true, true}},
		"dates later": {func(_ *Conditions, c *Conditions) { c.MoveInFrom, c.MoveInTo = day("2027-09-02"), day("2027-10-01") },
			ConditionsResult{true, true, false, true, true, true}},
		"viewer wants same gender, candidate differs": {func(v, c *Conditions) { v.RoommateGender, c.Gender = "same", "female" },
			ConditionsResult{true, true, true, false, true, true}},
		"candidate wants same gender, viewer differs": {func(_ *Conditions, c *Conditions) { c.Gender, c.RoommateGender = "female", "same" },
			ConditionsResult{true, true, true, false, true, true}},
		"both any, genders differ": {func(_ *Conditions, c *Conditions) { c.Gender = "female" },
			ConditionsResult{true, true, true, true, true, true}},
		"both want same, genders equal": {func(v, c *Conditions) { v.RoommateGender, c.RoommateGender = "same", "same" },
			ConditionsResult{true, true, true, true, true, true}},
		"free place and a pair not ready for it": {func(_ *Conditions, c *Conditions) { c.Scenario = ScenarioRoomOffer },
			ConditionsResult{true, true, true, true, false, true}},
		"free place and a pair ready for it": {func(v, c *Conditions) { v.AcceptsRoom, c.Scenario = true, ScenarioRoomOffer },
			ConditionsResult{true, true, true, true, true, true}},
		"two free places": {func(v, c *Conditions) { v.Scenario, c.Scenario = ScenarioRoomOffer, ScenarioRoomOffer },
			ConditionsResult{true, true, true, true, false, true}},
		"my required answer differs": {func(v, c *Conditions) {
			v.Required = []string{"noise"}
			c.Habits = map[string]string{"smoking": "no", "noise": "relaxed"}
		}, ConditionsResult{true, true, true, true, true, false}},
		"their required answer differs": {func(v, c *Conditions) {
			c.Required = []string{"smoking"}
			c.Habits = map[string]string{"smoking": "at_home", "noise": "quiet"}
		}, ConditionsResult{true, true, true, true, true, false}},
		"required question not answered by the candidate": {func(v, c *Conditions) {
			v.Required = []string{"noise"}
			c.Habits = map[string]string{"smoking": "no"}
		}, ConditionsResult{true, true, true, true, true, true}},
		"required answer is the same": {func(v, c *Conditions) { v.Required, c.Required = []string{"noise"}, []string{"smoking"} },
			ConditionsResult{true, true, true, true, true, true}},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			v, c := viewer(), viewer()
			tc.change(&v, &c)
			if got := CompareConditions(v, c); got != tc.want {
				t.Errorf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestCompareHabits(t *testing.T) {
	mine := map[string]string{"smoking": "no", "guests": "with_notice", "pets": "none"}
	theirs := map[string]string{"smoking": "no", "guests": "freely", "sleep": "after_1"}

	got := CompareHabits(mine, theirs)

	want := []HabitItem{
		{QuestionCode: "guests", Mine: "with_notice", Theirs: "freely", Result: Difference},
		{QuestionCode: "pets", Mine: "none", Result: NotComparable},
		{QuestionCode: "sleep", Theirs: "after_1", Result: NotComparable},
		{QuestionCode: "smoking", Mine: "no", Theirs: "no", Result: Match},
	}
	if len(got) != len(want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("item %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestSummaryCountsOnlyQuestionsBothAnswered(t *testing.T) {
	mine := map[string]string{"smoking": "no", "guests": "with_notice", "pets": "none"}
	theirs := map[string]string{"smoking": "no", "guests": "freely", "sleep": "after_1"}

	matched, compared := Summary(mine, theirs)

	if matched != 1 || compared != 2 {
		t.Errorf("matched=%d compared=%d, want 1 and 2", matched, compared)
	}
	if m, c := Summary(nil, theirs); m != 0 || c != 0 {
		t.Errorf("empty answers: matched=%d compared=%d", m, c)
	}
}

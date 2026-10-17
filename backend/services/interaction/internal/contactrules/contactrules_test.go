package contactrules

import "testing"

func TestValid(t *testing.T) {
	cases := []struct {
		kind, value string
		want        bool
	}{
		{"telegram", "dima_2006", true},
		{"telegram", "Abcde", true},
		{"telegram", "abcd", false},       // too short
		{"telegram", "@dima_2006", false}, // leading @ is rejected, not stripped
		{"telegram", "1dima", false},      // must start with a letter
		{"telegram", "t.me/dima", false},  // link
		{"telegram", "дима_2006", false},  // Latin only
		{"telegram", "a234567890123456789012345678901", true},
		{"telegram", "a2345678901234567890123456789012", true},
		{"telegram", "a23456789012345678901234567890123", false}, // 33 characters
		{"vk", "id123456", true},
		{"vk", "ivan.petrov", true},
		{"vk", "a", false},
		{"vk", "vk.com/id1", false},
		{"vk", "ivan petrov", false},
		{"phone", "79990000000", false}, // unknown kind
	}
	for _, tc := range cases {
		if got := Valid(tc.kind, tc.value); got != tc.want {
			t.Errorf("Valid(%q, %q) = %v, want %v", tc.kind, tc.value, got, tc.want)
		}
	}
}

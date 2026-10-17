// Package contactrules checks the format of a contact.
//
// Values are rejected, not repaired: a leading "@" or a link is an error the
// user sees, because silently changing a contact could send the counterpart to
// a different person.
package contactrules

import "regexp"

// CodeInvalidFormat is the field error code for a malformed contact value.
const CodeInvalidFormat = "invalid_format"

var formats = map[string]*regexp.Regexp{
	// Telegram username without "@": 5-32 characters, starts with a letter.
	"telegram": regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{4,31}$`),
	// VK short name or page id: "id123", "ivan.petrov", "durov".
	"vk": regexp.MustCompile(`^[A-Za-z0-9_.]{2,32}$`),
}

// Valid reports whether value is a well-formed contact of the given kind.
func Valid(kind, value string) bool {
	re, ok := formats[kind]
	return ok && re.MatchString(value)
}

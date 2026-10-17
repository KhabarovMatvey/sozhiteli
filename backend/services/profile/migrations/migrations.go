// Package migrations embeds the SQL migrations of the Profile service.
package migrations

import "embed"

// FS contains every migration file. New migrations are added as new numbered
// files; applied migrations are never edited.
//
//go:embed *.sql
var FS embed.FS

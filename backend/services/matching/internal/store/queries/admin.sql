-- Administrative reads are fixed queries against this service's own database.
-- name: GetAdminDatabase :one
SELECT current_database()::text AS database,
       pg_database_size(current_database())::bigint AS size_bytes,
       (SELECT count(*) FROM candidate)::bigint AS candidate_count,
       (SELECT count(*) FROM candidate_view)::bigint AS candidate_view_count,
       (SELECT count(*) FROM sync_state)::bigint AS sync_state_count;

-- name: ListAdminCandidates :many
SELECT user_id AS key_id,
       jsonb_build_array(user_id, source_version, display_name, birth_year,
         gender, occupation, city_id, districts, budget_min_rub, budget_max_rub,
         move_in_from, move_in_to, roommate_gender, questionnaire_version,
         habits, search_status, profile_updated_at, synced_at) AS row_data
FROM candidate
WHERE NOT sqlc.arg(has_cursor)::boolean OR user_id > sqlc.arg(after_id)::uuid
ORDER BY user_id
LIMIT sqlc.arg(page_size)::integer;

-- name: ListAdminCandidateViews :many
SELECT id AS key_id,
       jsonb_build_array(id, viewer_id, candidate_id, matched_count, compared_count, viewed_at) AS row_data
FROM candidate_view
WHERE NOT sqlc.arg(has_cursor)::boolean OR id > sqlc.arg(after_id)::bigint
ORDER BY id
LIMIT sqlc.arg(page_size)::integer;

-- name: ListAdminSyncStates :many
SELECT source AS key_source,
       jsonb_build_array(source, feed_cursor, updated_at) AS row_data
FROM sync_state
WHERE NOT sqlc.arg(has_cursor)::boolean OR source > sqlc.arg(after_source)::text
ORDER BY source
LIMIT sqlc.arg(page_size)::integer;

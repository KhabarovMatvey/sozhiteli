-- Contact values remain private even for administrators.
-- name: GetAdminDatabase :one
SELECT current_database()::text AS database,
       pg_database_size(current_database())::bigint AS size_bytes,
       (SELECT count(*) FROM contact_request)::bigint AS contact_request_count,
       (SELECT count(*) FROM contact)::bigint AS contact_count,
       (SELECT count(*) FROM user_block)::bigint AS user_block_count,
       (SELECT count(*) FROM report)::bigint AS report_count;

-- name: ListAdminContactRequests :many
SELECT id AS key_id,
       jsonb_build_array(id, sender_id, recipient_id, status, created_at, responded_at) AS row_data
FROM contact_request
WHERE NOT sqlc.arg(has_cursor)::boolean OR id > sqlc.arg(after_id)::uuid
ORDER BY id
LIMIT sqlc.arg(page_size)::integer;

-- name: ListAdminContacts :many
SELECT user_id AS key_id,
       jsonb_build_array(user_id, kind, updated_at) AS row_data
FROM contact
WHERE NOT sqlc.arg(has_cursor)::boolean OR user_id > sqlc.arg(after_id)::uuid
ORDER BY user_id
LIMIT sqlc.arg(page_size)::integer;

-- name: ListAdminUserBlocks :many
-- Ключ страницы - пара (blocker_id, blocked_id), закодированная одной строкой.
SELECT (blocker_id::text || '/' || blocked_id::text)::text AS key_id,
       jsonb_build_array(blocker_id, blocked_id, created_at) AS row_data
FROM user_block
WHERE NOT sqlc.arg(has_cursor)::boolean OR (blocker_id, blocked_id) > (sqlc.arg(after_blocker)::uuid, sqlc.arg(after_blocked)::uuid)
ORDER BY blocker_id, blocked_id
LIMIT sqlc.arg(page_size)::integer;

-- name: ListAdminReportRows :many
SELECT id AS key_id,
       jsonb_build_array(id, reporter_id, reported_id, reason, status, created_at, resolved_at) AS row_data
FROM report
WHERE NOT sqlc.arg(has_cursor)::boolean OR id > sqlc.arg(after_id)::uuid
ORDER BY id
LIMIT sqlc.arg(page_size)::integer;

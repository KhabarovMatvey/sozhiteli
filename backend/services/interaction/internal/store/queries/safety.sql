-- Блокировки и жалобы. Правила: README.md, раздел «Безопасность».

-- name: UpsertBlock :exec
INSERT INTO user_block (blocker_id, blocked_id)
VALUES (sqlc.arg(blocker_id), sqlc.arg(blocked_id))
ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

-- name: DeleteBlock :exec
DELETE FROM user_block
WHERE blocker_id = sqlc.arg(blocker_id)
  AND blocked_id = sqlc.arg(blocked_id);

-- name: CountBlocks :one
SELECT count(*)
FROM user_block
WHERE blocker_id = sqlc.arg(blocker_id);

-- name: ListBlocks :many
-- Число блокировок ограничено сервисом, поэтому список отдаётся целиком.
SELECT blocked_id, created_at
FROM user_block
WHERE blocker_id = sqlc.arg(blocker_id)
ORDER BY created_at DESC, blocked_id;

-- name: BlockExistsBetween :one
SELECT EXISTS (SELECT 1
               FROM user_block
               WHERE (blocker_id = sqlc.arg(user_a) AND blocked_id = sqlc.arg(user_b))
                  OR (blocker_id = sqlc.arg(user_b) AND blocked_id = sqlc.arg(user_a))) AS found;

-- name: DeclinePendingBetween :exec
-- Блокировка закрывает ожидающие запросы пары в обе стороны.
UPDATE contact_request
SET status       = 'declined',
    responded_at = now()
WHERE status = 'pending'
  AND ((sender_id = sqlc.arg(user_a) AND recipient_id = sqlc.arg(user_b))
    OR (sender_id = sqlc.arg(user_b) AND recipient_id = sqlc.arg(user_a)));

-- name: CountRecentReports :one
SELECT count(*)
FROM report
WHERE reporter_id = sqlc.arg(reporter_id)
  AND created_at > now() - interval '24 hours';

-- name: InsertReport :one
INSERT INTO report (reporter_id, reported_id, reason, comment)
VALUES (sqlc.arg(reporter_id), sqlc.arg(reported_id), sqlc.arg(reason), sqlc.arg(comment))
RETURNING *;

-- name: ListAdminReports :many
-- Очередь жалоб в порядке поступления. reported_open_count - сколько открытых
-- жалоб на того же человека: помогает заметить повторяющиеся.
SELECT r.*,
       (SELECT count(*) FROM report o WHERE o.reported_id = r.reported_id AND o.status = 'open')::bigint AS reported_open_count
FROM report r
WHERE r.status = sqlc.arg(status)
  AND (NOT sqlc.arg(has_cursor)::boolean OR r.id > sqlc.arg(after_id)::uuid)
ORDER BY r.id
LIMIT sqlc.arg(page_size)::integer;

-- name: ResolveReport :one
UPDATE report
SET status      = 'resolved',
    resolved_at = now()
WHERE id = sqlc.arg(id)
  AND status = 'open'
RETURNING *;

-- name: ReportExists :one
SELECT EXISTS (SELECT 1 FROM report WHERE id = sqlc.arg(id)) AS found;

-- name: CountOpenReportsAbout :one
SELECT count(*)
FROM report
WHERE reported_id = sqlc.arg(reported_id)
  AND status = 'open';

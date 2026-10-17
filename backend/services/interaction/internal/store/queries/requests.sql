-- Запросы на обмен контактами. Правило раскрытия
-- контакта - ADR-0005 в README.md: контакт собеседника виден только в запросе со
-- статусом accepted и только двум его участникам.

-- name: LockPair :exec
-- Сериализует операции над одной парой пользователей до конца транзакции:
-- без этого два встречных запроса могли бы создаться одновременно.
SELECT pg_advisory_xact_lock(
    hashtextextended(least(sqlc.arg(user_a)::text, sqlc.arg(user_b)::text) || ':' ||
                     greatest(sqlc.arg(user_a)::text, sqlc.arg(user_b)::text), 0));

-- name: ListRequestsBetween :many
SELECT *
FROM contact_request
WHERE (sender_id = sqlc.arg(user_a) AND recipient_id = sqlc.arg(user_b))
   OR (sender_id = sqlc.arg(user_b) AND recipient_id = sqlc.arg(user_a));

-- name: CountRecentRequests :one
-- Обслуживается индексом contact_request_outgoing_idx.
SELECT count(*)
FROM contact_request
WHERE sender_id = sqlc.arg(sender_id)
  AND created_at > now() - interval '24 hours';

-- name: InsertRequest :one
INSERT INTO contact_request (sender_id, recipient_id)
VALUES (sqlc.arg(sender_id), sqlc.arg(recipient_id))
RETURNING *;

-- name: ListIncoming :many
-- Входящие: собеседник - отправитель. Контакт собеседника присоединяется в
-- том же запросе и только для принятых запросов. Для первой страницы курсор -
-- дата в далёком будущем.
SELECT r.id,
       r.sender_id AS counterpart_id,
       r.status,
       r.created_at,
       r.responded_at,
       c.kind  AS counterpart_kind,
       c.value AS counterpart_value
FROM contact_request r
         LEFT JOIN contact c ON c.user_id = r.sender_id AND r.status = 'accepted'
WHERE r.recipient_id = sqlc.arg(user_id)
  AND (sqlc.narg(counterpart_id)::uuid IS NULL OR r.sender_id = sqlc.narg(counterpart_id)::uuid)
  AND (r.created_at, r.id) < (sqlc.arg(after_created_at)::timestamptz, sqlc.arg(after_id)::uuid)
ORDER BY r.created_at DESC, r.id DESC
LIMIT sqlc.arg(page_size);

-- name: ListOutgoing :many
-- Исходящие: собеседник - получатель. Правила те же, что у ListIncoming.
SELECT r.id,
       r.recipient_id AS counterpart_id,
       r.status,
       r.created_at,
       r.responded_at,
       c.kind  AS counterpart_kind,
       c.value AS counterpart_value
FROM contact_request r
         LEFT JOIN contact c ON c.user_id = r.recipient_id AND r.status = 'accepted'
WHERE r.sender_id = sqlc.arg(user_id)
  AND (sqlc.narg(counterpart_id)::uuid IS NULL OR r.recipient_id = sqlc.narg(counterpart_id)::uuid)
  AND (r.created_at, r.id) < (sqlc.arg(after_created_at)::timestamptz, sqlc.arg(after_id)::uuid)
ORDER BY r.created_at DESC, r.id DESC
LIMIT sqlc.arg(page_size);

-- name: RespondToRequest :one
-- Ответить может только получатель и только на ожидающий запрос.
UPDATE contact_request
SET status       = sqlc.arg(status),
    responded_at = now()
WHERE id = sqlc.arg(id)
  AND recipient_id = sqlc.arg(recipient_id)
  AND status = 'pending'
RETURNING *;

-- name: RequestExistsForRecipient :one
SELECT EXISTS (SELECT 1
               FROM contact_request
               WHERE id = sqlc.arg(id)
                 AND recipient_id = sqlc.arg(recipient_id)) AS found;

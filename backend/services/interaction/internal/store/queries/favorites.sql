-- Избранное и договорённости пары.

-- name: UpsertFavorite :exec
INSERT INTO favorite (owner_id, user_id)
VALUES (sqlc.arg(owner_id), sqlc.arg(user_id))
ON CONFLICT (owner_id, user_id) DO NOTHING;

-- name: DeleteFavorite :exec
DELETE FROM favorite
WHERE owner_id = sqlc.arg(owner_id)
  AND user_id = sqlc.arg(user_id);

-- name: CountFavorites :one
SELECT count(*)
FROM favorite
WHERE owner_id = sqlc.arg(owner_id);

-- name: ListFavorites :many
SELECT user_id, created_at
FROM favorite
WHERE owner_id = sqlc.arg(owner_id)
ORDER BY created_at DESC, user_id;

-- name: GetRequestForParticipant :one
-- Запрос, в котором вызывающий - отправитель или получатель.
SELECT *
FROM contact_request
WHERE id = sqlc.arg(id)
  AND (sender_id = sqlc.arg(user_id) OR recipient_id = sqlc.arg(user_id));

-- name: GetAgreement :one
SELECT *
FROM agreement
WHERE request_id = sqlc.arg(request_id);

-- name: UpsertAgreement :one
INSERT INTO agreement (request_id, items, updated_by)
VALUES (sqlc.arg(request_id), sqlc.arg(items), sqlc.arg(updated_by))
ON CONFLICT (request_id) DO UPDATE
    SET items      = EXCLUDED.items,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
RETURNING *;

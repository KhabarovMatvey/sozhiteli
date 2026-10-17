-- Собственный контакт пользователя (задача I-01). Значения контактов не
-- попадают ни в логи, ни в тексты ошибок.

-- name: GetContact :one
SELECT *
FROM contact
WHERE user_id = sqlc.arg(user_id);

-- name: UpsertContact :one
INSERT INTO contact (user_id, kind, value)
VALUES (sqlc.arg(user_id), sqlc.arg(kind), sqlc.arg(value))
ON CONFLICT (user_id) DO UPDATE
    SET kind       = EXCLUDED.kind,
        value      = EXCLUDED.value,
        updated_at = now()
RETURNING *;

-- name: ContactExists :one
SELECT EXISTS (SELECT 1 FROM contact WHERE user_id = sqlc.arg(user_id)) AS found;

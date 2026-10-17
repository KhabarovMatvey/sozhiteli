-- Запросы ленты изменений анкет (внутренний API, ADR-0004).

-- name: GetFeedHorizon :one
-- Граница ленты: версии меньше неё записаны уже завершившимися транзакциями и
-- больше не могут появиться.
SELECT (pg_snapshot_xmin(pg_current_snapshot())::text::bigint) AS horizon;

-- name: ListChangedProfiles :many
SELECT user_id,
       feed_version,
       display_name,
       birth_year,
       gender,
       occupation,
       city_id,
       districts,
       budget_min_rub,
       budget_max_rub,
       move_in_from,
       move_in_to,
       roommate_gender,
       questionnaire_version,
       habits,
       search_status,
       updated_at
FROM profile
WHERE (feed_version, user_id) > (sqlc.arg(after_version)::bigint, sqlc.arg(after_user_id)::uuid)
  AND feed_version < sqlc.arg(horizon)::bigint
ORDER BY feed_version, user_id
LIMIT sqlc.arg(page_size);

-- name: ListDeletedProfiles :many
SELECT user_id,
       feed_version
FROM profile_deletion
WHERE (feed_version, user_id) > (sqlc.arg(after_version)::bigint, sqlc.arg(after_user_id)::uuid)
  AND feed_version < sqlc.arg(horizon)::bigint
ORDER BY feed_version, user_id
LIMIT sqlc.arg(page_size);

-- Выдача и карточки кандидатов (задачи M-01, M-02, M-03). Только своя база:
-- данные анкет - проекция, которую поддерживает internal/projection.

-- name: GetCandidate :one
SELECT *
FROM candidate
WHERE user_id = sqlc.arg(user_id);

-- name: ListFeed :many
-- Один запрос на страницу. Обслуживается частичным индексом candidate_feed_idx
-- (city_id, profile_updated_at DESC, user_id DESC) WHERE search_status = 'searching'.
-- Для первой страницы курсор - дата в далёком будущем, чтобы условие оставалось
-- одним и тем же и индекс использовался всегда.
SELECT *
FROM candidate c
WHERE c.search_status = 'searching'
  AND c.city_id = sqlc.arg(city_id)
  AND c.user_id <> sqlc.arg(viewer_id)
  AND c.budget_min_rub <= sqlc.arg(budget_max_rub)
  AND c.budget_max_rub >= sqlc.arg(budget_min_rub)
  AND c.move_in_from <= sqlc.arg(move_in_to)
  AND c.move_in_to >= sqlc.arg(move_in_from)
  AND (sqlc.arg(viewer_roommate_gender)::text = 'any' OR c.gender = sqlc.arg(viewer_gender)::text)
  AND (c.roommate_gender = 'any' OR c.gender = sqlc.arg(viewer_gender)::text)
  AND (c.profile_updated_at, c.user_id) < (sqlc.arg(after_updated_at)::timestamptz, sqlc.arg(after_user_id)::uuid)
ORDER BY c.profile_updated_at DESC, c.user_id DESC
LIMIT sqlc.arg(page_size);

-- name: ListCandidatesByID :many
-- Порядок результата не гарантирован; его восстанавливает обработчик.
SELECT *
FROM candidate
WHERE user_id = ANY (sqlc.arg(user_ids)::uuid[]);

-- name: RecordCandidateView :exec
-- Факт просмотра карточки со сравнением: измерение гипотезы (ADR-0010).
INSERT INTO candidate_view (viewer_id, candidate_id, matched_count, compared_count)
VALUES (sqlc.arg(viewer_id), sqlc.arg(candidate_id), sqlc.arg(matched_count), sqlc.arg(compared_count));

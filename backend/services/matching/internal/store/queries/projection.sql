-- Запросы синхронизации проекции анкет (ADR-0004).

-- name: GetSyncCursor :one
SELECT feed_cursor
FROM sync_state
WHERE source = sqlc.arg(source);

-- name: AdvanceSyncCursor :execrows
-- Сдвигает курсор, только если он не изменился с момента чтения: при
-- нескольких репликах страницу применяет ровно одна.
UPDATE sync_state
SET feed_cursor = sqlc.arg(new_cursor),
    updated_at  = now()
WHERE source = sqlc.arg(source)
  AND feed_cursor = sqlc.arg(old_cursor);

-- name: UpsertCandidate :exec
-- Идемпотентно: повторная или устаревшая запись не перезаписывает более новую.
INSERT INTO candidate (user_id, source_version, display_name, birth_year, gender, occupation,
                       city_id, districts, budget_min_rub, budget_max_rub, move_in_from,
                       move_in_to, roommate_gender, questionnaire_version, habits,
                       search_status, profile_updated_at)
VALUES (sqlc.arg(user_id), sqlc.arg(source_version), sqlc.arg(display_name), sqlc.arg(birth_year),
        sqlc.arg(gender), sqlc.arg(occupation), sqlc.arg(city_id), sqlc.arg(districts),
        sqlc.arg(budget_min_rub), sqlc.arg(budget_max_rub), sqlc.arg(move_in_from),
        sqlc.arg(move_in_to), sqlc.arg(roommate_gender), sqlc.arg(questionnaire_version),
        sqlc.arg(habits), sqlc.arg(search_status), sqlc.arg(profile_updated_at))
ON CONFLICT (user_id) DO UPDATE
    SET source_version        = EXCLUDED.source_version,
        display_name          = EXCLUDED.display_name,
        birth_year            = EXCLUDED.birth_year,
        gender                = EXCLUDED.gender,
        occupation            = EXCLUDED.occupation,
        city_id               = EXCLUDED.city_id,
        districts             = EXCLUDED.districts,
        budget_min_rub        = EXCLUDED.budget_min_rub,
        budget_max_rub        = EXCLUDED.budget_max_rub,
        move_in_from          = EXCLUDED.move_in_from,
        move_in_to            = EXCLUDED.move_in_to,
        roommate_gender       = EXCLUDED.roommate_gender,
        questionnaire_version = EXCLUDED.questionnaire_version,
        habits                = EXCLUDED.habits,
        search_status         = EXCLUDED.search_status,
        profile_updated_at    = EXCLUDED.profile_updated_at,
        synced_at             = now()
WHERE candidate.source_version <= EXCLUDED.source_version;

-- name: DeleteCandidate :exec
-- Удаляет копию, только если отметка об удалении не старее самой копии.
DELETE
FROM candidate
WHERE user_id = sqlc.arg(user_id)
  AND source_version <= sqlc.arg(source_version);

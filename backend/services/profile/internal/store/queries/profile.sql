-- Анкета пользователя (операции getMyProfile и putMyProfile, задачи P-02, P-03).

-- name: GetProfile :one
SELECT *
FROM profile
WHERE user_id = sqlc.arg(user_id);

-- name: UpsertProfile :one
-- Создаёт или полностью заменяет анкету. created_at сохраняется при замене;
-- updated_at и feed_version ставит триггер profile_touch, поэтому здесь их нет.
INSERT INTO profile (user_id, display_name, birth_year, gender, occupation, city_id, districts,
                     budget_min_rub, budget_max_rub, move_in_from, move_in_to, roommate_gender,
                     questionnaire_version, habits, search_status)
VALUES (sqlc.arg(user_id), sqlc.arg(display_name), sqlc.arg(birth_year), sqlc.arg(gender),
        sqlc.arg(occupation), sqlc.arg(city_id), sqlc.arg(districts), sqlc.arg(budget_min_rub),
        sqlc.arg(budget_max_rub), sqlc.arg(move_in_from), sqlc.arg(move_in_to),
        sqlc.arg(roommate_gender), sqlc.arg(questionnaire_version), sqlc.arg(habits),
        sqlc.arg(search_status))
ON CONFLICT (user_id) DO UPDATE
    SET display_name          = EXCLUDED.display_name,
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
        search_status         = EXCLUDED.search_status
RETURNING *;

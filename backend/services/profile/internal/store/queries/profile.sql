-- Анкета пользователя (операции getMyProfile и putMyProfile).

-- name: GetProfile :one
SELECT *
FROM profile
WHERE user_id = sqlc.arg(user_id);

-- name: UpsertProfile :one
-- Создаёт или полностью заменяет анкету. created_at сохраняется при замене;
-- updated_at и feed_version ставит триггер profile_touch, поэтому здесь их нет.
INSERT INTO profile (user_id, display_name, birth_year, gender, occupation, city_id, districts,
                     budget_min_rub, budget_max_rub, move_in_from, move_in_to, roommate_gender,
                     questionnaire_version, habits, search_status, scenario, accepts_room,
                     utilities_rub, deposit_rub, place_note, required_habits)
VALUES (sqlc.arg(user_id), sqlc.arg(display_name), sqlc.arg(birth_year), sqlc.arg(gender),
        sqlc.arg(occupation), sqlc.arg(city_id), sqlc.arg(districts), sqlc.arg(budget_min_rub),
        sqlc.arg(budget_max_rub), sqlc.arg(move_in_from), sqlc.arg(move_in_to),
        sqlc.arg(roommate_gender), sqlc.arg(questionnaire_version), sqlc.arg(habits),
        sqlc.arg(search_status), sqlc.arg(scenario), sqlc.arg(accepts_room),
        sqlc.narg(utilities_rub), sqlc.narg(deposit_rub), sqlc.arg(place_note),
        sqlc.arg(required_habits)::text[])
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
        search_status         = EXCLUDED.search_status,
        scenario              = EXCLUDED.scenario,
        accepts_room          = EXCLUDED.accepts_room,
        utilities_rub         = EXCLUDED.utilities_rub,
        deposit_rub           = EXCLUDED.deposit_rub,
        place_note            = EXCLUDED.place_note,
        required_habits       = EXCLUDED.required_habits
RETURNING *;

-- name: DeleteProfile :execrows
-- Удаляет анкету. Отметку для ленты изменений создаёт триггер profile_record_deletion.
DELETE FROM profile
WHERE user_id = sqlc.arg(user_id);

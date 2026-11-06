-- Администратор видит только заранее перечисленные таблицы своей базы.
-- SQL не содержит имён таблиц или выражений, полученных из HTTP-запроса.

-- name: AdminDatabaseInfo :one
SELECT current_database()::text AS database_name,
       pg_database_size(current_database())::bigint AS size_bytes;

-- name: AdminTableCounts :many
SELECT 'profile'::text AS table_name, count(*)::bigint AS row_count FROM profile
UNION ALL
SELECT 'city'::text, count(*)::bigint FROM city
UNION ALL
SELECT 'profile_deletion'::text, count(*)::bigint FROM profile_deletion;

-- name: AdminListProfiles :many
SELECT ARRAY[user_id::text, display_name, birth_year::text, gender, occupation,
             city_id::text, districts, budget_min_rub::text, budget_max_rub::text,
             move_in_from::text, move_in_to::text, roommate_gender,
             questionnaire_version::text, habits::text, search_status,
             created_at::text, updated_at::text, feed_version::text]::text[] AS cells
FROM profile
WHERE NOT sqlc.arg(has_after)::boolean OR user_id > sqlc.arg(after_id)::uuid
ORDER BY user_id
LIMIT sqlc.arg(row_limit)::integer;

-- name: AdminListCities :many
SELECT ARRAY[id::text, name, region]::text[] AS cells
FROM city
WHERE NOT sqlc.arg(has_after)::boolean OR id > sqlc.arg(after_id)::smallint
ORDER BY id
LIMIT sqlc.arg(row_limit)::integer;

-- name: AdminListProfileDeletions :many
SELECT ARRAY[user_id::text, feed_version::text, deleted_at::text]::text[] AS cells
FROM profile_deletion
WHERE NOT sqlc.arg(has_after)::boolean OR user_id > sqlc.arg(after_id)::uuid
ORDER BY user_id
LIMIT sqlc.arg(row_limit)::integer;

-- name: AdminSearchProfiles :many
-- Анкеты для администратора. Keyset по user_id; поиск по части имени без учёта
-- регистра (strpos, а не LIKE, поэтому пользовательский ввод не интерпретируется как шаблон)
-- или по полному идентификатору пользователя.
SELECT *
FROM profile
WHERE (NOT sqlc.arg(has_after)::boolean OR user_id > sqlc.arg(after_id)::uuid)
  AND (sqlc.arg(needle)::text = ''
       OR strpos(lower(display_name), lower(sqlc.arg(needle)::text)) > 0
       OR user_id::text = lower(sqlc.arg(needle)::text))
ORDER BY user_id
LIMIT sqlc.arg(row_limit)::integer;

-- name: AdminProfileIDs :many
-- Какие из учётных записей страницы уже имеют анкету (один запрос на страницу).
SELECT user_id
FROM profile
WHERE user_id = ANY(sqlc.arg(user_ids)::uuid[]);

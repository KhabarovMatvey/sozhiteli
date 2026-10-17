-- Справочник городов (операция listCities).

-- name: ListCities :many
-- Около 1100 строк, меняется редко: отдаётся целиком, без пагинации.
-- Сортировка по правилам русского алфавита (ICU), а не по байтам.
SELECT id, name, region
FROM city
ORDER BY name COLLATE "ru-RU-x-icu", region COLLATE "ru-RU-x-icu";

-- name: CityExists :one
SELECT EXISTS (SELECT 1 FROM city WHERE id = sqlc.arg(id)) AS found;

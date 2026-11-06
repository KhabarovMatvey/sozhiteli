-- Сценарий поиска и свободное место (функции Must №1 и №5, сегмент 2),
-- готовность заехать в уже снятую квартиру (S1-05c) и обязательные вопросы
-- анкеты (функция Must №8, истории S1-04b и S2-03b).

-- +goose Up
ALTER TABLE profile
    -- pair - ищу соседа, чтобы снять квартиру вместе; room_offer - сдаю
    -- свободное место в своей квартире. Для room_offer budget_min_rub =
    -- budget_max_rub = аренда за место, move_in_* - когда место свободно.
    ADD COLUMN scenario        text    NOT NULL DEFAULT 'pair' CHECK (scenario IN ('pair', 'room_offer')),
    ADD COLUMN accepts_room    boolean NOT NULL DEFAULT false,
    ADD COLUMN utilities_rub   integer CHECK (utilities_rub BETWEEN 0 AND 1000000),
    ADD COLUMN deposit_rub     integer CHECK (deposit_rub BETWEEN 0 AND 1000000),
    ADD COLUMN place_note      text    NOT NULL DEFAULT '' CHECK (char_length(place_note) <= 500),
    -- Коды вопросов анкеты, по которым нужен тот же ответ.
    ADD COLUMN required_habits text[]  NOT NULL DEFAULT '{}',
    ADD CONSTRAINT profile_place_fields CHECK (
        (scenario = 'room_offer' AND utilities_rub IS NOT NULL AND deposit_rub IS NOT NULL
            AND NOT accepts_room AND budget_min_rub = budget_max_rub)
        OR (scenario = 'pair' AND utilities_rub IS NULL AND deposit_rub IS NULL AND place_note = ''));

-- +goose Down
ALTER TABLE profile
    DROP CONSTRAINT profile_place_fields,
    DROP COLUMN required_habits,
    DROP COLUMN place_note,
    DROP COLUMN deposit_rub,
    DROP COLUMN utilities_rub,
    DROP COLUMN accepts_room,
    DROP COLUMN scenario;

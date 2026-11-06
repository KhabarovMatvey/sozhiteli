-- Поля анкеты для сценария сегмента 2 и обязательных вопросов. Копия
-- данных Profile: заполняется применением ленты изменений.

-- +goose Up
ALTER TABLE candidate
    ADD COLUMN scenario        text    NOT NULL DEFAULT 'pair',
    ADD COLUMN accepts_room    boolean NOT NULL DEFAULT false,
    ADD COLUMN utilities_rub   integer,
    ADD COLUMN deposit_rub     integer,
    ADD COLUMN place_note      text    NOT NULL DEFAULT '',
    ADD COLUMN required_habits text[]  NOT NULL DEFAULT '{}';

-- +goose Down
ALTER TABLE candidate
    DROP COLUMN required_habits,
    DROP COLUMN place_note,
    DROP COLUMN deposit_rub,
    DROP COLUMN utilities_rub,
    DROP COLUMN accepts_room,
    DROP COLUMN scenario;

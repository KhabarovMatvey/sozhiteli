-- Статус «сосед найден»: пользователь завершает поиск с итогом (функция Must
-- №12 приоритизации, истории S1-12b и S2-12b). Как и paused, скрывает анкету
-- из выдачи, но отличает успешное завершение от паузы.

-- +goose Up
ALTER TABLE profile DROP CONSTRAINT profile_search_status_check;
ALTER TABLE profile ADD CONSTRAINT profile_search_status_check
    CHECK (search_status IN ('searching', 'paused', 'found'));

-- +goose Down
UPDATE profile SET search_status = 'paused' WHERE search_status = 'found';
ALTER TABLE profile DROP CONSTRAINT profile_search_status_check;
ALTER TABLE profile ADD CONSTRAINT profile_search_status_check
    CHECK (search_status IN ('searching', 'paused'));

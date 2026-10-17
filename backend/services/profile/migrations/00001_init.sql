-- Схема сервиса Profile. Владелец данных: только сервис Profile.
-- Правила: docs/DATA_OWNERSHIP.md. Механизм ленты изменений: docs/adr/0004.

-- +goose Up

-- Справочник городов, в которых доступен поиск. Наполняется отдельной
-- миграцией после решения владельца продукта (docs/MVP_SCOPE.md, вопрос Q-1).
CREATE TABLE city (
    id   smallint PRIMARY KEY,
    name text NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 2 AND 80)
);

-- Анкета пользователя. Все поля обязательны: частично заполненных анкет нет.
-- Контактов здесь нет и быть не должно - ими владеет сервис Interaction.
CREATE TABLE profile (
    -- Идентификатор пользователя = claim "sub" access-токена.
    user_id               uuid PRIMARY KEY,
    display_name          text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 40),
    birth_year            smallint NOT NULL CHECK (birth_year BETWEEN 1930 AND 2100),
    gender                text NOT NULL CHECK (gender IN ('female', 'male')),
    occupation            text NOT NULL CHECK (char_length(occupation) BETWEEN 2 AND 80),
    city_id               smallint NOT NULL REFERENCES city (id),
    districts             text NOT NULL CHECK (char_length(districts) <= 200),
    -- Доля аренды на человека в месяц, без коммунальных платежей.
    budget_min_rub        integer NOT NULL CHECK (budget_min_rub BETWEEN 0 AND 1000000),
    budget_max_rub        integer NOT NULL CHECK (budget_max_rub BETWEEN 0 AND 1000000),
    move_in_from          date NOT NULL,
    move_in_to            date NOT NULL,
    roommate_gender       text NOT NULL CHECK (roommate_gender IN ('any', 'same')),
    questionnaire_version integer NOT NULL CHECK (questionnaire_version > 0),
    -- Ответы анкеты: {"код вопроса": "код варианта"}. Проверяются сервисом по
    -- определению анкеты указанной версии.
    habits                jsonb NOT NULL CHECK (jsonb_typeof(habits) = 'object'),
    search_status         text NOT NULL CHECK (search_status IN ('searching', 'paused')),
    created_at            timestamptz NOT NULL DEFAULT now(),
    -- updated_at и feed_version выставляет триггер profile_touch; приложение
    -- их не передаёт.
    updated_at            timestamptz NOT NULL DEFAULT now(),
    feed_version          bigint NOT NULL DEFAULT 0,
    CONSTRAINT profile_budget_range CHECK (budget_min_rub <= budget_max_rub),
    CONSTRAINT profile_move_in_range CHECK (move_in_from <= move_in_to)
);

CREATE INDEX profile_feed_idx ON profile (feed_version, user_id);

-- Отметки об удалённых анкетах: нужны, чтобы потребители ленты изменений
-- удалили свои копии. Персональных данных не содержат.
CREATE TABLE profile_deletion (
    user_id      uuid PRIMARY KEY,
    feed_version bigint NOT NULL,
    deleted_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX profile_deletion_feed_idx ON profile_deletion (feed_version, user_id);

-- feed_version = идентификатор транзакции, записавшей строку. Лента отдаёт
-- только строки с версией меньше самой старой ещё открытой транзакции, поэтому
-- потребитель не может пропустить изменение, зафиксированное позже.
-- +goose StatementBegin
CREATE FUNCTION profile_touch() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    NEW.feed_version := pg_current_xact_id()::text::bigint;
    NEW.updated_at := now();
    IF TG_OP = 'INSERT' THEN
        DELETE FROM profile_deletion WHERE user_id = NEW.user_id;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER profile_touch
    BEFORE INSERT OR UPDATE ON profile
    FOR EACH ROW EXECUTE FUNCTION profile_touch();

-- +goose StatementBegin
CREATE FUNCTION profile_record_deletion() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    INSERT INTO profile_deletion (user_id, feed_version)
    VALUES (OLD.user_id, pg_current_xact_id()::text::bigint)
    ON CONFLICT (user_id) DO UPDATE
        SET feed_version = EXCLUDED.feed_version,
            deleted_at   = now();
    RETURN OLD;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER profile_record_deletion
    AFTER DELETE ON profile
    FOR EACH ROW EXECUTE FUNCTION profile_record_deletion();

-- +goose Down
DROP TRIGGER profile_record_deletion ON profile;
DROP FUNCTION profile_record_deletion();
DROP TRIGGER profile_touch ON profile;
DROP FUNCTION profile_touch();
DROP TABLE profile_deletion;
DROP TABLE profile;
DROP TABLE city;

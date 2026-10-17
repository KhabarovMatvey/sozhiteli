-- Схема сервиса Matching. Владелец данных: только сервис Matching.
-- Правила: README.md, раздел «Данные». Механизм проекции: ADR-0004.

-- +goose Up

-- Проекция анкет: копия данных Profile, которую Matching строит сам по ленте
-- изменений. Источник истины - Profile; эту таблицу можно удалить и построить
-- заново, обнулив курсор в sync_state. Ограничений на значения здесь нет
-- намеренно: их проверяет владелец данных.
CREATE TABLE candidate (
    user_id               uuid PRIMARY KEY,
    -- Версия записи в ленте Profile; защищает от применения устаревших данных.
    source_version        bigint NOT NULL,
    display_name          text NOT NULL,
    birth_year            smallint NOT NULL,
    gender                text NOT NULL,
    occupation            text NOT NULL,
    city_id               smallint NOT NULL,
    districts             text NOT NULL,
    budget_min_rub        integer NOT NULL,
    budget_max_rub        integer NOT NULL,
    move_in_from          date NOT NULL,
    move_in_to            date NOT NULL,
    roommate_gender       text NOT NULL,
    questionnaire_version integer NOT NULL,
    habits                jsonb NOT NULL,
    search_status         text NOT NULL,
    profile_updated_at    timestamptz NOT NULL,
    synced_at             timestamptz NOT NULL DEFAULT now()
);

-- Индекс выдачи: кандидаты одного города в порядке убывания времени
-- обновления анкеты (порядок сортировки и курсора listCandidates).
CREATE INDEX candidate_feed_idx
    ON candidate (city_id, profile_updated_at DESC, user_id DESC)
    WHERE search_status = 'searching';

-- Позиция чтения ленты изменений для каждого источника.
CREATE TABLE sync_state (
    source      text PRIMARY KEY,
    feed_cursor text NOT NULL DEFAULT '',
    updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sync_state (source) VALUES ('profile');

-- Факты просмотра карточки кандидата со сравнением: минимальная фиксация
-- событий для статистики использования (ADR-0010). Только добавление.
CREATE TABLE candidate_view (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    viewer_id      uuid NOT NULL,
    candidate_id   uuid NOT NULL,
    matched_count  smallint NOT NULL,
    compared_count smallint NOT NULL,
    viewed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX candidate_view_viewed_at_idx ON candidate_view (viewed_at);

-- +goose Down
DROP TABLE candidate_view;
DROP TABLE sync_state;
DROP TABLE candidate;

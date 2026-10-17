-- Схема сервиса Interaction. Владелец данных: только сервис Interaction.
-- Правила: README.md, раздел «Данные». Правило раскрытия контакта: ADR-0005.

-- +goose Up

-- Приватный контакт пользователя. Самые чувствительные данные системы: чужой
-- контакт отдаётся только участникам запроса со статусом accepted.
CREATE TABLE contact (
    -- Идентификатор пользователя = claim "sub" access-токена.
    user_id    uuid PRIMARY KEY,
    kind       text NOT NULL CHECK (kind IN ('telegram', 'vk')),
    value      text NOT NULL CHECK (char_length(value) BETWEEN 2 AND 64),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Запрос на обмен контактами: действие, которым пользователь показывает
-- намерение продолжить общение.
CREATE TABLE contact_request (
    -- uuidv7 упорядочен по времени: вставки идут в конец индекса.
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    sender_id    uuid NOT NULL,
    recipient_id uuid NOT NULL,
    status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    responded_at timestamptz,
    CONSTRAINT contact_request_not_self CHECK (sender_id <> recipient_id),
    CONSTRAINT contact_request_responded CHECK ((status = 'pending') = (responded_at IS NULL)),
    -- Один запрос от отправителя к получателю; встречный запрос запрещает сервис.
    CONSTRAINT contact_request_pair_unique UNIQUE (sender_id, recipient_id)
);

-- Списки входящих и исходящих в порядке сортировки listContactRequests.
-- Второй индекс также обслуживает подсчёт суточного лимита отправителя.
CREATE INDEX contact_request_incoming_idx ON contact_request (recipient_id, created_at DESC, id DESC);
CREATE INDEX contact_request_outgoing_idx ON contact_request (sender_id, created_at DESC, id DESC);

-- +goose Down
DROP TABLE contact_request;
DROP TABLE contact;

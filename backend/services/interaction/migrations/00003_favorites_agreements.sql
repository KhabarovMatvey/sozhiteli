-- Избранное (функция Should №15) и договорённости пары (функция Should №16).

-- +goose Up

-- Сохранённые кандидаты: владелец видит их отдельным списком.
CREATE TABLE favorite (
    owner_id   uuid NOT NULL,
    user_id    uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, user_id),
    CONSTRAINT favorite_not_self CHECK (owner_id <> user_id)
);

-- Договорённости о быте после обмена контактами: одна запись на принятый
-- запрос, редактируют оба участника.
CREATE TABLE agreement (
    request_id uuid PRIMARY KEY REFERENCES contact_request (id) ON DELETE CASCADE,
    -- {"тема": "текст"}; темы проверяет сервис.
    items      jsonb NOT NULL CHECK (jsonb_typeof(items) = 'object'),
    updated_by uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE agreement;
DROP TABLE favorite;

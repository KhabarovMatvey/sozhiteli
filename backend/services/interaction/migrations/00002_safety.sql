-- Защита от нежелательных контактов: блокировки и жалобы (функция Must №13
-- приоритизации). Правила: README.md, раздел «Безопасность».

-- +goose Up

-- Блокировка: blocker_id больше не получает запросов от blocked_id и не видит
-- его контакт. Действует в обе стороны: заблокировавший тоже не может
-- отправить запрос, пока не снимет блокировку.
CREATE TABLE user_block (
    blocker_id uuid NOT NULL,
    blocked_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CONSTRAINT user_block_not_self CHECK (blocker_id <> blocked_id)
);

-- Проверка «есть ли блокировка в любую сторону» читает оба индекса.
CREATE INDEX user_block_blocked_idx ON user_block (blocked_id, blocker_id);

-- Жалоба на пользователя. Рассматривается администратором вручную; меры к
-- анкете администратор принимает в Profile (редактирование или удаление).
CREATE TABLE report (
    id          uuid PRIMARY KEY DEFAULT uuidv7(),
    reporter_id uuid NOT NULL,
    reported_id uuid NOT NULL,
    reason      text NOT NULL CHECK (reason IN ('fake', 'commercial', 'offensive', 'fraud', 'other')),
    comment     text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 500),
    status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    CONSTRAINT report_not_self CHECK (reporter_id <> reported_id),
    CONSTRAINT report_resolved CHECK ((status = 'open') = (resolved_at IS NULL))
);

-- Одна открытая жалоба от человека на человека: повторная не добавляет сведений.
CREATE UNIQUE INDEX report_open_pair_idx ON report (reporter_id, reported_id) WHERE status = 'open';
-- Очередь администратора и суточный лимит отправителя.
CREATE INDEX report_queue_idx ON report (status, id);
CREATE INDEX report_reporter_idx ON report (reporter_id, created_at);
CREATE INDEX report_reported_idx ON report (reported_id);

-- +goose Down
DROP TABLE report;
DROP TABLE user_block;

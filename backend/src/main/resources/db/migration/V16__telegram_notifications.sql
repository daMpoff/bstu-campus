CREATE TABLE telegram_pairing_code (
    bot_id bigint NOT NULL,
    user_id bigint NOT NULL REFERENCES campus_user(id) ON DELETE CASCADE,
    code_hash bytea NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (bot_id, user_id)
);

CREATE TABLE telegram_chat (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bot_id bigint NOT NULL,
    user_id bigint NOT NULL REFERENCES campus_user(id) ON DELETE CASCADE,
    chat_id bigint NOT NULL,
    linked_at timestamptz NOT NULL,
    UNIQUE (bot_id, user_id),
    UNIQUE (bot_id, chat_id)
);

CREATE TABLE telegram_poll_cursor (
    bot_id bigint PRIMARY KEY,
    next_update_id bigint,
    last_update_at timestamptz
);

CREATE TABLE telegram_delivery (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    binding_id bigint NOT NULL REFERENCES telegram_chat(id) ON DELETE CASCADE,
    event_id bigint REFERENCES personal_feed_event(id) ON DELETE CASCADE,
    assignment_id bigint REFERENCES assignment(id) ON DELETE CASCADE,
    reminder_hours integer CHECK (reminder_hours IN (2, 24)),
    available_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    completed_at timestamptz,
    attempts integer NOT NULL DEFAULT 0,
    CHECK ((event_id IS NOT NULL AND assignment_id IS NULL AND reminder_hours IS NULL)
        OR (event_id IS NULL AND assignment_id IS NOT NULL AND reminder_hours IS NOT NULL)),
    UNIQUE (binding_id, event_id),
    UNIQUE (binding_id, assignment_id, reminder_hours)
);

CREATE INDEX telegram_delivery_pending ON telegram_delivery (available_at, id) WHERE completed_at IS NULL;
CREATE INDEX telegram_delivery_expiry ON telegram_delivery (expires_at);

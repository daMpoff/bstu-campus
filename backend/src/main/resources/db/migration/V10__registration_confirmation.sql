ALTER TABLE campus_user
    ADD COLUMN email_verified boolean NOT NULL DEFAULT true,
    ADD COLUMN group_verified boolean NOT NULL DEFAULT true,
    ADD COLUMN group_verified_by bigint REFERENCES campus_user(id),
    ADD COLUMN group_verified_at timestamptz;

ALTER TABLE campus_user
    ALTER COLUMN email_verified SET DEFAULT false,
    ALTER COLUMN group_verified SET DEFAULT false;

CREATE TABLE email_confirmation (
    user_id bigint PRIMARY KEY REFERENCES campus_user(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL
);

CREATE TABLE campus_mail (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id bigint UNIQUE,
    recipient text NOT NULL,
    subject text NOT NULL,
    body text,
    available_at timestamptz NOT NULL,
    expires_at timestamptz,
    sent_at timestamptz,
    attempts integer NOT NULL DEFAULT 0
);

CREATE INDEX campus_mail_pending ON campus_mail(available_at, id) WHERE body IS NOT NULL;

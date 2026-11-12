CREATE TABLE user_avatar (
    user_id bigint PRIMARY KEY REFERENCES campus_user(id) ON DELETE CASCADE,
    revision uuid NOT NULL,
    content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 1100000)
);

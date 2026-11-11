CREATE TABLE poll (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    teacher_id bigint NOT NULL REFERENCES campus_user(id),
    title text NOT NULL,
    description text NOT NULL,
    ends_at timestamptz NOT NULL,
    anonymous boolean NOT NULL,
    created_at timestamptz NOT NULL
);

CREATE INDEX poll_by_teacher ON poll(teacher_id, ends_at DESC, id DESC);
CREATE INDEX poll_by_end ON poll(ends_at);

CREATE TABLE poll_group (
    poll_id bigint REFERENCES poll(id) ON DELETE CASCADE,
    group_id bigint REFERENCES study_group(id),
    PRIMARY KEY (poll_id, group_id)
);

CREATE INDEX poll_group_by_group ON poll_group(group_id, poll_id);

CREATE TABLE poll_question (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    poll_id bigint NOT NULL REFERENCES poll(id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position >= 0),
    text text NOT NULL,
    choice_type text NOT NULL CHECK (choice_type IN ('SINGLE', 'MULTIPLE')),
    UNIQUE (poll_id, position)
);

CREATE TABLE poll_option (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    question_id bigint NOT NULL REFERENCES poll_question(id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position >= 0),
    text text NOT NULL,
    UNIQUE (question_id, position)
);

-- A receipt prevents repeat voting without connecting an anonymous ballot to an account.
CREATE TABLE poll_voter (
    poll_id bigint REFERENCES poll(id) ON DELETE CASCADE,
    student_id bigint REFERENCES campus_user(id),
    PRIMARY KEY (poll_id, student_id)
);

CREATE TABLE poll_ballot (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    poll_id bigint NOT NULL REFERENCES poll(id) ON DELETE CASCADE,
    student_id bigint REFERENCES campus_user(id)
);

CREATE INDEX poll_ballot_by_poll ON poll_ballot(poll_id, id);

CREATE TABLE poll_selection (
    ballot_id bigint REFERENCES poll_ballot(id) ON DELETE CASCADE,
    option_id bigint REFERENCES poll_option(id) ON DELETE CASCADE,
    PRIMARY KEY (ballot_id, option_id)
);

CREATE INDEX poll_selection_by_option ON poll_selection(option_id);

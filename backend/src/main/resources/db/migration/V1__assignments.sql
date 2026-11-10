CREATE TABLE study_group (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL UNIQUE
);

CREATE TABLE campus_user (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    full_name text NOT NULL,
    role text NOT NULL CHECK (role IN ('TEACHER', 'STUDENT')),
    group_id bigint REFERENCES study_group(id),
    rating integer NOT NULL DEFAULT 1000 CHECK (rating BETWEEN 0 AND 1000),
    CHECK ((role = 'STUDENT') = (group_id IS NOT NULL))
);

CREATE TABLE assignment (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    teacher_id bigint NOT NULL REFERENCES campus_user(id),
    title text NOT NULL,
    description text NOT NULL,
    deadline timestamptz NOT NULL,
    penalty_limit integer NOT NULL CHECK (penalty_limit BETWEEN 0 AND 1000)
);

CREATE TABLE assignment_group (
    assignment_id bigint REFERENCES assignment(id),
    group_id bigint REFERENCES study_group(id),
    PRIMARY KEY (assignment_id, group_id)
);

CREATE TABLE student_work (
    assignment_id bigint REFERENCES assignment(id),
    student_id bigint REFERENCES campus_user(id),
    status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SUBMITTED', 'RETURNED', 'ACCEPTED')),
    work_link text,
    file_name text,
    file_content bytea,
    submitted_at timestamptz,
    deducted integer NOT NULL DEFAULT 0 CHECK (deducted >= 0),
    next_penalty_at timestamptz NOT NULL,
    PRIMARY KEY (assignment_id, student_id)
);

CREATE INDEX due_work ON student_work(next_penalty_at)
    WHERE status IN ('OPEN', 'RETURNED');

CREATE TABLE rating_entry (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    assignment_id bigint NOT NULL,
    student_id bigint NOT NULL,
    amount integer NOT NULL CHECK (amount < 0),
    recorded_at timestamptz NOT NULL,
    FOREIGN KEY (assignment_id, student_id) REFERENCES student_work(assignment_id, student_id)
);

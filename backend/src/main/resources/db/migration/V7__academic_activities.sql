CREATE TABLE activity (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    teacher_id bigint NOT NULL REFERENCES campus_user(id),
    title text NOT NULL,
    description text NOT NULL,
    occurs_at timestamptz NOT NULL,
    max_points integer NOT NULL CHECK (max_points > 0)
);

CREATE TABLE activity_group (
    activity_id bigint REFERENCES activity(id),
    group_id bigint REFERENCES study_group(id),
    PRIMARY KEY (activity_id, group_id)
);

CREATE INDEX activity_group_by_group ON activity_group(group_id, activity_id);

CREATE TABLE activity_award (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    activity_id bigint NOT NULL,
    student_id bigint NOT NULL REFERENCES campus_user(id),
    group_id bigint NOT NULL,
    participation integer NOT NULL CHECK (participation IN (25, 50, 75, 100)),
    points numeric(12, 2) NOT NULL CHECK (points > 0),
    awarded_at timestamptz NOT NULL,
    UNIQUE (activity_id, student_id),
    FOREIGN KEY (activity_id, group_id) REFERENCES activity_group(activity_id, group_id)
);

CREATE INDEX activity_award_by_student ON activity_award(student_id, awarded_at DESC, id DESC);

CREATE TABLE teacher_group_budget (
    teacher_id bigint REFERENCES campus_user(id),
    group_id bigint REFERENCES study_group(id),
    month_start date CHECK (EXTRACT(DAY FROM month_start) = 1),
    spent numeric(12, 2) NOT NULL DEFAULT 0 CHECK (spent >= 0),
    awards integer NOT NULL DEFAULT 0 CHECK (awards >= 0),
    PRIMARY KEY (teacher_id, group_id, month_start)
);

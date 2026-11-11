ALTER TABLE activity ADD COLUMN kind text NOT NULL DEFAULT 'ACADEMIC'
    CHECK (kind IN ('ACADEMIC', 'PUBLIC'));

CREATE TABLE activity_enrollment (
    activity_id bigint NOT NULL,
    student_id bigint NOT NULL REFERENCES campus_user(id),
    group_id bigint NOT NULL,
    enrolled_at timestamptz NOT NULL,
    PRIMARY KEY (activity_id, student_id),
    FOREIGN KEY (activity_id, group_id) REFERENCES activity_group(activity_id, group_id)
);

CREATE INDEX activity_award_feed ON activity_award(awarded_at DESC, id DESC);

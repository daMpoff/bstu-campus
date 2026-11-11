ALTER TABLE assignment ADD COLUMN individual boolean NOT NULL DEFAULT false;

CREATE INDEX student_work_by_student ON student_work(student_id, assignment_id);

CREATE TABLE assignment_material (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    assignment_id bigint NOT NULL,
    student_id bigint NOT NULL,
    file_name text NOT NULL,
    file_content bytea NOT NULL,
    file_hash bytea GENERATED ALWAYS AS (sha256(file_content)) STORED,
    preview_available boolean NOT NULL,
    added_at timestamptz NOT NULL,
    FOREIGN KEY (assignment_id, student_id) REFERENCES student_work(assignment_id, student_id) ON DELETE CASCADE,
    UNIQUE (assignment_id, student_id, file_name, file_hash)
);

CREATE TABLE assistant_publication (
    teacher_id bigint NOT NULL REFERENCES campus_user(id),
    request_id uuid NOT NULL,
    assignment_id bigint REFERENCES assignment(id),
    PRIMARY KEY (teacher_id, request_id)
);

ALTER TABLE personal_feed_event DROP CONSTRAINT personal_feed_event_event_type_check;
ALTER TABLE personal_feed_event ADD CONSTRAINT personal_feed_event_event_type_check CHECK (event_type IN (
    'ASSIGNMENT_CREATED', 'ASSIGNMENT_DUE', 'ASSIGNMENT_MATERIAL_ADDED', 'WORK_ACCEPTED', 'WORK_RETURNED',
    'ACTIVITY_AWARDED', 'POLL_CREATED', 'ACTIVITY_CREATED', 'WORK_SUBMITTED', 'POLL_ENDED'
));

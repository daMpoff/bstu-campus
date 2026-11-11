CREATE TABLE group_responsible_teacher (
    group_id bigint NOT NULL REFERENCES study_group(id) ON DELETE CASCADE,
    teacher_id bigint NOT NULL REFERENCES campus_user(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, teacher_id)
);

CREATE INDEX group_responsible_teacher_by_teacher ON group_responsible_teacher(teacher_id, group_id);

ALTER TABLE study_group ADD COLUMN leader_student_id bigint REFERENCES campus_user(id) ON DELETE SET NULL;

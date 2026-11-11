-- Existing students can receive credits from the rollout day, without backdating earlier semesters.
ALTER TABLE campus_user
    ADD COLUMN semester_credit_from date NOT NULL DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date);

-- A newly registered student already receives 1000 AR, so that day's credit does not apply.
ALTER TABLE campus_user
    ALTER COLUMN semester_credit_from SET DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date + 1);

CREATE TABLE semester_replenishment_run (
    semester_start date PRIMARY KEY,
    amount integer NOT NULL CHECK (amount > 0),
    applied_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX semester_replenishment_once_per_term
    ON semester_replenishment_run (EXTRACT(YEAR FROM semester_start), (EXTRACT(MONTH FROM semester_start) > 6));

ALTER TABLE rating_entry
    ALTER COLUMN assignment_id DROP NOT NULL,
    DROP CONSTRAINT rating_entry_amount_check,
    ADD COLUMN semester_start date REFERENCES semester_replenishment_run(semester_start),
    ADD FOREIGN KEY (student_id) REFERENCES campus_user(id),
    ADD CONSTRAINT rating_entry_reason_check CHECK (
        (assignment_id IS NOT NULL AND semester_start IS NULL AND amount < 0)
        OR (assignment_id IS NULL AND semester_start IS NOT NULL AND amount > 0)
    );

CREATE UNIQUE INDEX rating_entry_once_per_semester
    ON rating_entry (student_id, semester_start) WHERE semester_start IS NOT NULL;

ALTER TABLE campus_user DROP CONSTRAINT campus_user_role_check;
ALTER TABLE campus_user ADD CONSTRAINT campus_user_role_check CHECK (role IN ('TEACHER', 'STUDENT', 'ADMIN'));

CREATE TABLE campus_settings (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    penalty_amount integer NOT NULL CHECK (penalty_amount BETWEEN 1 AND 1000),
    penalty_interval_seconds integer NOT NULL CHECK (penalty_interval_seconds BETWEEN 1 AND 86400),
    semester_amount integer NOT NULL CHECK (semester_amount BETWEEN 0 AND 1000),
    semester_start_days text NOT NULL,
    activity_monthly_limit integer NOT NULL CHECK (activity_monthly_limit >= 0)
);

CREATE TABLE faculty (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code text NOT NULL UNIQUE,
    name text NOT NULL
);

CREATE TABLE department (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code text NOT NULL UNIQUE,
    faculty_id bigint NOT NULL REFERENCES faculty(id),
    name text NOT NULL
);

ALTER TABLE study_group ADD COLUMN study_form text
    CHECK (study_form IN ('очная', 'очно-заочное', 'заочное'));

ALTER TABLE campus_user
    ADD COLUMN faculty_id bigint REFERENCES faculty(id),
    ADD COLUMN department_id bigint REFERENCES department(id),
    ADD CHECK (role <> 'STUDENT' OR department_id IS NULL),
    ADD CHECK (role <> 'TEACHER' OR faculty_id IS NULL);

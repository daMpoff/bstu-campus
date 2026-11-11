ALTER TABLE activity ADD COLUMN attendance_format text
    CHECK (attendance_format IN ('IN_PERSON', 'REMOTE'));

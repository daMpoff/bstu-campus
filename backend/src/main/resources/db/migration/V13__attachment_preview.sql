-- NULL means the attachment predates format validation at submission time.
ALTER TABLE student_work ADD COLUMN preview_available boolean;

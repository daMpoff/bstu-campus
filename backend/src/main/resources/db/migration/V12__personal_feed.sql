CREATE TABLE personal_feed_event (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recipient_id bigint NOT NULL REFERENCES campus_user(id) ON DELETE CASCADE,
    event_type text NOT NULL CHECK (event_type IN (
        'ASSIGNMENT_CREATED', 'ASSIGNMENT_DUE', 'WORK_ACCEPTED', 'WORK_RETURNED',
        'ACTIVITY_AWARDED', 'POLL_CREATED', 'ACTIVITY_CREATED', 'WORK_SUBMITTED', 'POLL_ENDED'
    )),
    entity_id bigint NOT NULL,
    occurred_at timestamptz NOT NULL,
    title text NOT NULL,
    details text NOT NULL,
    link_path text NOT NULL,
    notify_email boolean NOT NULL DEFAULT true
);

CREATE INDEX personal_feed_by_recipient ON personal_feed_event(recipient_id, occurred_at DESC, id DESC);
CREATE UNIQUE INDEX personal_feed_one_reminder ON personal_feed_event(recipient_id, event_type, entity_id)
    WHERE event_type IN ('ASSIGNMENT_DUE', 'POLL_ENDED');

CREATE FUNCTION record_work_feed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    kind text;
    heading text;
    recipient bigint;
    event_time timestamptz := clock_timestamp();
    task_title text;
    detail text;
BEGIN
    SELECT title INTO task_title FROM assignment WHERE id = NEW.assignment_id;
    recipient := NEW.student_id;
    detail := task_title;
    IF TG_OP = 'INSERT' THEN
        kind := 'ASSIGNMENT_CREATED';
        heading := 'Новое задание';
    ELSIF OLD.status = NEW.status THEN
        RETURN NEW;
    ELSIF NEW.status = 'SUBMITTED' THEN
        kind := 'WORK_SUBMITTED';
        heading := 'Работа сдана';
        SELECT teacher_id INTO recipient FROM assignment WHERE id = NEW.assignment_id;
        SELECT concat(full_name, ' · ', task_title) INTO detail FROM campus_user WHERE id = NEW.student_id;
        event_time := COALESCE(NEW.submitted_at, event_time);
    ELSIF NEW.status = 'ACCEPTED' THEN
        kind := 'WORK_ACCEPTED';
        heading := 'Работа принята';
    ELSIF NEW.status = 'RETURNED' THEN
        kind := 'WORK_RETURNED';
        heading := 'Работа возвращена на доработку';
    ELSE
        RETURN NEW;
    END IF;

    INSERT INTO personal_feed_event (recipient_id, event_type, entity_id, occurred_at, title, details, link_path)
    SELECT u.id, kind, NEW.assignment_id, event_time, heading, detail, '/assignments/' || NEW.assignment_id
    FROM campus_user u
    WHERE u.id = recipient AND u.email_verified AND (u.role = 'TEACHER' OR u.group_verified);
    RETURN NEW;
END;
$$;

CREATE TRIGGER student_work_feed AFTER INSERT OR UPDATE OF status ON student_work
    FOR EACH ROW EXECUTE FUNCTION record_work_feed();

CREATE FUNCTION record_activity_group_feed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO personal_feed_event (recipient_id, event_type, entity_id, occurred_at, title, details, link_path)
    SELECT u.id, 'ACTIVITY_CREATED', a.id, clock_timestamp(), 'Новая активность', a.title, '/activities'
    FROM activity a JOIN campus_user u ON u.group_id = NEW.group_id
    WHERE a.id = NEW.activity_id AND u.role = 'STUDENT' AND u.email_verified AND u.group_verified;
    RETURN NEW;
END;
$$;

CREATE TRIGGER activity_group_feed AFTER INSERT ON activity_group
    FOR EACH ROW EXECUTE FUNCTION record_activity_group_feed();

CREATE FUNCTION record_poll_group_feed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO personal_feed_event (recipient_id, event_type, entity_id, occurred_at, title, details, link_path)
    SELECT u.id, 'POLL_CREATED', p.id, p.created_at, 'Новый опрос', p.title, '/polls/' || p.id
    FROM poll p JOIN campus_user u ON u.group_id = NEW.group_id
    WHERE p.id = NEW.poll_id AND u.role = 'STUDENT' AND u.email_verified AND u.group_verified;
    RETURN NEW;
END;
$$;

CREATE TRIGGER poll_group_feed AFTER INSERT ON poll_group
    FOR EACH ROW EXECUTE FUNCTION record_poll_group_feed();

CREATE FUNCTION insert_award_feed(award activity_award, send_email boolean) RETURNS void LANGUAGE sql AS $$
    INSERT INTO personal_feed_event (recipient_id, event_type, entity_id, occurred_at, title, details, link_path, notify_email)
    SELECT award.student_id, 'ACTIVITY_AWARDED', a.id, award.awarded_at, 'Начислены баллы активности',
        concat(a.title, ' · +', replace(trim_scale(award.points)::text, '.', ','), ' ',
            CASE a.kind WHEN 'ACADEMIC' THEN 'БУА' ELSE 'БОА' END), '/profile', send_email
    FROM activity a JOIN campus_user u ON u.id = award.student_id
    WHERE a.id = award.activity_id AND u.email_verified AND u.group_verified;
$$;

-- Existing awards already have an authoritative time. Email is reserved for new awards.
SELECT insert_award_feed(award, false) FROM activity_award award;

CREATE FUNCTION record_award_feed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM insert_award_feed(NEW, true);
    RETURN NEW;
END;
$$;

CREATE TRIGGER activity_award_feed AFTER INSERT ON activity_award
    FOR EACH ROW EXECUTE FUNCTION record_award_feed();

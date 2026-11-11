DO $scenario$
DECLARE
    teacher bigint;
    alexey bigint;
    maria bigint;
    target_group bigint;
    assignment bigint;
    activity bigint;
    course_poll bigint;
    question bigint;
    item record;
    seed_time timestamptz := current_timestamp;
    penalty_interval interval := make_interval(secs => current_setting('campus.demo_interval')::int);
    budget_limit int := current_setting('campus.demo_budget')::int;
    deducted int;
    award_points numeric(12, 2);
    award_month date;
BEGIN
    SELECT id INTO target_group FROM study_group WHERE name = 'ИВТ-24' AND study_form IS NULL;
    SELECT id INTO teacher FROM campus_user WHERE email = 'teacher@bgtu.test' AND role = 'TEACHER';
    SELECT id INTO alexey FROM campus_user WHERE email = 'student@bgtu.test' AND role = 'STUDENT'
        AND group_id = target_group AND email_verified AND group_verified;
    SELECT id INTO maria FROM campus_user WHERE email = 'student2@bgtu.test' AND role = 'STUDENT'
        AND group_id = target_group AND email_verified AND group_verified;
    IF teacher IS NULL OR alexey IS NULL OR maria IS NULL THEN
        RETURN;
    END IF;
    INSERT INTO campus_demo_seed (scenario) VALUES ('databases-course') ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT LEAST(rating, 20) INTO deducted FROM campus_user WHERE id = alexey FOR UPDATE;
    FOR item IN
        SELECT * FROM (VALUES
            ('Практическая работа № 1. Схема базы данных',
             'Спроектируйте базу данных университетской библиотеки. Выделите сущности, первичные и внешние ключи. Приложите SQL-скрипт создания таблиц.',
             seed_time - interval '5 days', seed_time - interval '10 days', 40, 'ACCEPTED', 'ACCEPTED',
             'Схема библиотеки.txt', $work$CREATE TABLE books (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title text NOT NULL
);

CREATE TABLE readers (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name text NOT NULL
);

CREATE TABLE loans (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    book_id bigint NOT NULL REFERENCES books(id),
    reader_id bigint NOT NULL REFERENCES readers(id),
    borrowed_at date NOT NULL,
    returned_at date,
    CHECK (returned_at IS NULL OR returned_at >= borrowed_at)
);$work$),
            ('Лабораторная работа № 2. Запросы к базе данных',
             'Напишите запросы для каталога библиотеки: список невозвращённых книг и число выдач по каждой книге. Приложите запросы и кратко поясните результат.',
             seed_time + interval '2 days', seed_time - interval '3 days', 40, 'SUBMITTED', 'OPEN',
             'Запросы к каталогу.txt', $work$-- 1. Книги, которые ещё находятся у читателей.
SELECT b.title, r.full_name, l.borrowed_at
FROM loans l
JOIN books b ON b.id = l.book_id
JOIN readers r ON r.id = l.reader_id
WHERE l.returned_at IS NULL
ORDER BY l.borrowed_at;

-- 2. Число выдач по каждой книге, включая книги без выдач.
SELECT b.title, COUNT(l.id) AS loan_count
FROM books b
LEFT JOIN loans l ON l.book_id = b.id
GROUP BY b.id, b.title
ORDER BY loan_count DESC, b.title;$work$),
            ('Практическая работа № 3. Индексы и EXPLAIN',
             'Добавьте индекс для поиска открытых выдач. Сравните планы EXPLAIN до и после изменения и объясните, когда PostgreSQL выбирает последовательное чтение.',
             seed_time + interval '7 days', seed_time - interval '1 hour', 60, 'OPEN', 'OPEN', NULL, NULL)
        ) AS task(title, description, deadline, assigned_at, penalty_limit, alexey_status, maria_status, file_name, content)
    LOOP
        INSERT INTO assignment (teacher_id, title, description, deadline, penalty_limit)
        VALUES (teacher, item.title, item.description, item.deadline, item.penalty_limit) RETURNING id INTO assignment;
        INSERT INTO assignment_group (assignment_id, group_id) VALUES (assignment, target_group);

        INSERT INTO student_work (assignment_id, student_id, status, file_name, file_content, preview_available,
                                  submitted_at, deducted, next_penalty_at)
        SELECT assignment, work.student_id, work.status,
            CASE WHEN work.status <> 'OPEN' THEN item.file_name END,
            CASE WHEN work.status <> 'OPEN' THEN convert_to(item.content, 'UTF8') END,
            work.status <> 'OPEN',
            CASE
                WHEN work.student_id = alexey AND work.status = 'ACCEPTED' THEN item.deadline + penalty_interval
                WHEN work.status = 'ACCEPTED' THEN item.deadline - interval '4 hours'
                WHEN work.status = 'SUBMITTED' THEN seed_time - interval '2 hours'
            END,
            CASE WHEN work.student_id = alexey AND work.status = 'ACCEPTED' THEN deducted ELSE 0 END,
            item.deadline + penalty_interval
        FROM (VALUES (alexey, item.alexey_status), (maria, item.maria_status)) AS work(student_id, status);

        UPDATE personal_feed_event SET occurred_at = item.assigned_at, notify_email = false
        WHERE entity_id = assignment AND event_type = 'ASSIGNMENT_CREATED';

        INSERT INTO personal_feed_event
            (recipient_id, event_type, entity_id, occurred_at, title, details, link_path, notify_email)
        SELECT teacher, 'WORK_SUBMITTED', assignment, w.submitted_at, 'Работа сдана',
            u.full_name || ' · ' || item.title, '/assignments/' || assignment, false
        FROM student_work w JOIN campus_user u ON u.id = w.student_id
        WHERE w.assignment_id = assignment AND w.submitted_at IS NOT NULL
        UNION ALL
        SELECT w.student_id, 'WORK_ACCEPTED', assignment, w.submitted_at + interval '1 hour',
            'Работа принята', item.title, '/assignments/' || assignment, false
        FROM student_work w WHERE w.assignment_id = assignment AND w.status = 'ACCEPTED';

        IF item.alexey_status = 'ACCEPTED' AND deducted > 0 THEN
            UPDATE campus_user SET rating = rating - deducted WHERE id = alexey;
            INSERT INTO rating_entry (assignment_id, student_id, amount, recorded_at)
            VALUES (assignment, alexey, -deducted, item.deadline + penalty_interval);
        END IF;
    END LOOP;

    FOR item IN
        SELECT * FROM (VALUES
            ('Разбор SQL-запросов', 'На практикуме разобрали ошибки в JOIN и GROUP BY и проверили запросы на учебном наборе данных.',
             'ACADEMIC', 80, seed_time - interval '1 day', 75),
            ('День открытых дверей ФИТ', 'Помощь посетителям с навигацией и демонстрацией студенческих проектов.',
             'PUBLIC', 80, seed_time - interval '3 days', 50),
            ('Практикум по оптимизации запросов', 'Сравним планы выполнения запросов на небольшом и большом наборе данных.',
             'ACADEMIC', 60, seed_time + interval '4 days', NULL)
        ) AS event(title, description, kind, max_points, occurs_at, participation)
    LOOP
        INSERT INTO activity (teacher_id, title, description, kind, max_points, occurs_at)
        VALUES (teacher, item.title, item.description, item.kind, item.max_points, item.occurs_at) RETURNING id INTO activity;
        INSERT INTO activity_group (activity_id, group_id) VALUES (activity, target_group);
        UPDATE personal_feed_event
        SET occurred_at = LEAST(seed_time, item.occurs_at - interval '2 days'), notify_email = false
        WHERE entity_id = activity AND event_type = 'ACTIVITY_CREATED';

        IF item.kind = 'PUBLIC' THEN
            INSERT INTO activity_enrollment (activity_id, student_id, group_id, enrolled_at)
            VALUES (activity, alexey, target_group, item.occurs_at - interval '1 day');
        END IF;
        IF item.participation IS NOT NULL THEN
            award_points := item.max_points * item.participation / 100.0;
            award_month := date_trunc('month', (item.occurs_at + interval '2 hours') AT TIME ZONE 'Europe/Moscow')::date;
            IF award_points <= budget_limit THEN
                INSERT INTO teacher_group_budget AS budget (teacher_id, group_id, month_start, spent, awards)
                VALUES (teacher, target_group, award_month, award_points, 1)
                ON CONFLICT (teacher_id, group_id, month_start) DO UPDATE
                    SET spent = budget.spent + EXCLUDED.spent, awards = budget.awards + 1
                    WHERE budget.spent + EXCLUDED.spent <= budget_limit;
                IF FOUND THEN
                    INSERT INTO activity_award (activity_id, student_id, group_id, participation, points, awarded_at)
                    VALUES (activity, alexey, target_group, item.participation, award_points, item.occurs_at + interval '2 hours');
                    UPDATE personal_feed_event SET notify_email = false
                    WHERE entity_id = activity AND event_type = 'ACTIVITY_AWARDED' AND recipient_id = alexey;
                END IF;
            END IF;
        END IF;
    END LOOP;

    INSERT INTO poll (teacher_id, title, description, ends_at, anonymous, created_at)
    VALUES (teacher, 'Тема следующей консультации по базам данных',
            'Выберите тему, которой стоит уделить больше времени перед сдачей лабораторной работы.',
            seed_time + interval '5 days', true, seed_time - interval '30 minutes') RETURNING id INTO course_poll;
    INSERT INTO poll_group (poll_id, group_id) VALUES (course_poll, target_group);
    INSERT INTO poll_question (poll_id, position, text, choice_type)
    VALUES (course_poll, 1, 'Какую тему разобрать на консультации?', 'SINGLE') RETURNING id INTO question;
    INSERT INTO poll_option (question_id, position, text)
    VALUES (question, 1, 'Виды JOIN'), (question, 2, 'Группировка и агрегаты'), (question, 3, 'Индексы и планы запросов');
END
$scenario$;

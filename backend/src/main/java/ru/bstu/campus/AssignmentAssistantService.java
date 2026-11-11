package ru.bstu.campus;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
class AssignmentAssistantService {
    private final JdbcClient db;
    private final AssignmentService assignments;
    private final Clock clock;

    AssignmentAssistantService(JdbcClient db, AssignmentService assignments, Clock clock) {
        this.db = db;
        this.assignments = assignments;
        this.clock = clock;
    }

    record Recipient(long id, String fullName, String context) {}
    record Target(long id, String title, Instant deadline) {}
    record Material(long id, String fileName, boolean previewAvailable, String senderName, String recipientName, Instant addedAt) {}
    record Receipt(long assignmentId, String path) {
        Receipt(long id) {
            this(id, "/assignments/" + id);
        }
    }

    List<Recipient> recipients(AssignmentService.Account actor, String input) {
        requireTransferRole(actor);
        if (input.length() > 120) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Введите ФИО длиной до 120 символов.");
        }
        String query = input.toLowerCase(Locale.ROOT).replace('ё', 'е')
            .replaceAll("[^\\p{L}\\p{M}\\p{N} -]+", " ").strip();
        return db.sql("""
            SELECT u.id, u.full_name, COALESCE(g.name, d.name, 'Преподаватель') AS context
            FROM campus_user u LEFT JOIN study_group g ON g.id = u.group_id
            LEFT JOIN department d ON d.id = u.department_id
            WHERE u.email_verified AND (
                (:role = 'TEACHER' AND u.role = 'STUDENT' AND u.group_verified)
                OR (:role = 'STUDENT' AND u.role = 'TEACHER' AND EXISTS (
                    SELECT 1 FROM assignment a JOIN student_work w ON w.assignment_id = a.id
                    WHERE a.teacher_id = u.id AND w.student_id = :actor AND w.status IN ('OPEN', 'RETURNED')
                ))
            )
              AND NOT EXISTS (
                  SELECT 1 FROM regexp_split_to_table(:query, ' +') AS part
                  WHERE strpos(translate(lower(u.full_name), 'ё', 'е'), part) = 0
                    AND (length(part) < 5
                         OR strpos(translate(lower(u.full_name), 'ё', 'е'), left(part, length(part) - 2)) = 0)
              )
            ORDER BY (translate(lower(u.full_name), 'ё', 'е') = :query) DESC, u.full_name, u.id
            LIMIT 12
            """).param("actor", actor.id()).param("role", actor.role()).param("query", query)
            .query(Recipient.class).list();
    }

    List<Target> targets(AssignmentService.Account actor, long recipient) {
        requireTransferRole(actor);
        return db.sql("""
            SELECT a.id, a.title, a.deadline FROM assignment a JOIN student_work w ON w.assignment_id = a.id
            WHERE (:role = 'TEACHER' AND a.teacher_id = :actor AND w.student_id = :recipient)
               OR (:role = 'STUDENT' AND a.teacher_id = :recipient AND w.student_id = :actor
                   AND w.status IN ('OPEN', 'RETURNED'))
            ORDER BY a.deadline DESC, a.id DESC
            """).param("role", actor.role()).param("actor", actor.id()).param("recipient", recipient)
            .query((row, index) -> new Target(row.getLong(1), row.getString(2),
                row.getObject(3, OffsetDateTime.class).toInstant())).list();
    }

    @Transactional
    Receipt transfer(AssignmentService.Account actor, long recipient, long assignment, AssignmentUpload upload) {
        requireTransferRole(actor);
        if (upload == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Прикрепите файл.");
        if ("TEACHER".equals(actor.role())) {
            attach(actor, recipient, assignment, upload);
        } else {
            db.sql("""
                SELECT a.id FROM assignment a JOIN student_work w ON w.assignment_id = a.id
                WHERE a.id = :assignment AND a.teacher_id = :recipient AND w.student_id = :actor
                """).param("assignment", assignment).param("recipient", recipient).param("actor", actor.id())
                .query(Long.class).optional().orElseThrow(AssignmentAssistantService::unavailable);
            assignments.submit(actor.id(), assignment, null, upload.name(), upload.content());
        }
        return new Receipt(assignment);
    }

    @Transactional
    Receipt publish(AssignmentService.Account actor, UUID requestId, long recipient, String title,
                    String description, Instant deadline, Integer penaltyLimit, AssignmentUpload upload) {
        if (!"TEACHER".equals(actor.role())) throw forbidden();
        int reserved = db.sql("""
            INSERT INTO assistant_publication (teacher_id, request_id)
            VALUES (:teacher, :request) ON CONFLICT DO NOTHING
            """).param("teacher", actor.id()).param("request", requestId).update();
        if (reserved == 0) {
            long previous = db.sql("""
                SELECT assignment_id FROM assistant_publication WHERE teacher_id = :teacher AND request_id = :request
                """).param("teacher", actor.id()).param("request", requestId).query(Long.class).single();
            return new Receipt(previous);
        }
        long id = assignments.createForStudent(actor.id(), recipient, title, description, deadline, penaltyLimit);
        if (upload != null) attach(actor, recipient, id, upload);
        db.sql("""
            UPDATE assistant_publication SET assignment_id = :assignment
            WHERE teacher_id = :teacher AND request_id = :request
            """).param("assignment", id).param("teacher", actor.id()).param("request", requestId).update();
        return new Receipt(id);
    }

    List<Material> materials(AssignmentService.Account actor, long assignment) {
        return db.sql("""
            SELECT m.id, m.file_name, m.preview_available, t.full_name AS sender_name,
                   s.full_name AS recipient_name, m.added_at
            FROM assignment_material m JOIN assignment a ON a.id = m.assignment_id
            JOIN campus_user t ON t.id = a.teacher_id JOIN campus_user s ON s.id = m.student_id
            WHERE a.id = :assignment AND (
                (:role = 'TEACHER' AND a.teacher_id = :actor) OR (:role = 'STUDENT' AND m.student_id = :actor))
            ORDER BY m.id DESC
            """).param("assignment", assignment).param("role", actor.role()).param("actor", actor.id())
            .query((row, index) -> new Material(row.getLong(1), row.getString(2), row.getBoolean(3),
                row.getString(4), row.getString(5), row.getObject(6, OffsetDateTime.class).toInstant())).list();
    }

    AssignmentService.Attachment material(AssignmentService.Account actor, long id) {
        return db.sql("""
            SELECT m.file_name, m.file_content FROM assignment_material m JOIN assignment a ON a.id = m.assignment_id
            WHERE m.id = :id AND (
                (:role = 'TEACHER' AND a.teacher_id = :actor) OR (:role = 'STUDENT' AND m.student_id = :actor))
            """).param("id", id).param("role", actor.role()).param("actor", actor.id())
            .query((row, index) -> new AssignmentService.Attachment(row.getString(1), row.getBytes(2)))
            .optional().orElseThrow(AssignmentAssistantService::unavailable);
    }

    private void attach(AssignmentService.Account teacher, long recipient, long assignment, AssignmentUpload upload) {
        String title = db.sql("""
            SELECT a.title FROM assignment a JOIN student_work w ON w.assignment_id = a.id
            WHERE a.id = :assignment AND a.teacher_id = :teacher AND w.student_id = :recipient
            FOR KEY SHARE OF w
            """).param("assignment", assignment).param("teacher", teacher.id()).param("recipient", recipient)
            .query(String.class).optional().orElseThrow(AssignmentAssistantService::unavailable);
        var now = AssignmentService.timestamp(clock.instant());
        int inserted = db.sql("""
            INSERT INTO assignment_material (assignment_id, student_id, file_name, file_content, preview_available, added_at)
            VALUES (:assignment, :student, :name, :content, :preview, :now) ON CONFLICT DO NOTHING
            """).param("assignment", assignment).param("student", recipient).param("name", upload.name())
            .param("content", upload.content()).param("preview", AttachmentPreview.type(upload.name(), upload.content()).isPresent())
            .param("now", now).update();
        if (inserted == 0) return;
        db.sql("""
            INSERT INTO personal_feed_event (recipient_id, event_type, entity_id, occurred_at, title, details, link_path, notify_email)
            VALUES (:student, 'ASSIGNMENT_MATERIAL_ADDED', :assignment, :now, 'Новый файл к заданию',
                :details, :path, false)
            """).param("student", recipient).param("assignment", assignment).param("now", now)
            .param("details", teacher.fullName() + " · " + title + " · " + upload.name())
            .param("path", "/assignments/" + assignment).update();
    }

    private static void requireTransferRole(AssignmentService.Account actor) {
        if (!"TEACHER".equals(actor.role()) && !"STUDENT".equals(actor.role())) throw forbidden();
    }

    private static ResponseStatusException forbidden() {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, "Это действие недоступно для вашей роли.");
    }

    private static ResponseStatusException unavailable() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Задание, получатель или файл недоступны.");
    }
}

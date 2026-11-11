package ru.bstu.campus;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
class StudentProfileService {
    private final JdbcClient db;
    private final Clock clock;

    StudentProfileService(JdbcClient db, Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    record Student(long id, String fullName, String facultyName, String groupName, int rating, Long arPlace,
                   BigDecimal academicActivityPoints, BigDecimal publicActivityPoints) {}
    record Assignment(long id, String title, Instant deadline, String status, Integer penaltyLimit, Integer deducted) {}
    record RatingEntry(long id, String currency, String assignmentTitle, LocalDate semesterStart,
                       String activityTitle, String teacherName, BigDecimal amount, Instant recordedAt) {}
    record PersonalDetails(List<Assignment> assignments, List<RatingEntry> ratingHistory) {}
    record Profile(Student student, PersonalDetails personal) {}

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    Profile profile(long studentId, String viewer) {
        Student student = db.sql("""
            SELECT u.id, u.full_name, f.name AS faculty_name, g.name AS group_name, u.rating, points.*,
                   CASE WHEN u.email = :viewer AND u.group_verified AND u.email_verified THEN (
                       SELECT 1 + count(DISTINCT participant.rating)
                       FROM campus_user participant JOIN study_group participant_group ON participant_group.id = participant.group_id
                       WHERE participant.role = 'STUDENT' AND participant.group_verified AND participant.email_verified
                         AND participant.rating > u.rating
                   ) END AS ar_place
            FROM campus_user u
            JOIN study_group g ON g.id = u.group_id
            LEFT JOIN faculty f ON f.id = COALESCE(g.faculty_id, u.faculty_id)
            CROSS JOIN LATERAL (
                SELECT COALESCE(sum(award.points) FILTER (WHERE a.kind = 'ACADEMIC'), 0) AS academic_activity_points,
                       COALESCE(sum(award.points) FILTER (WHERE a.kind = 'PUBLIC'), 0) AS public_activity_points
                FROM activity_award award JOIN activity a ON a.id = award.activity_id
                WHERE award.student_id = u.id
            ) points
            WHERE u.id = :id AND u.role = 'STUDENT'
            """).param("id", studentId).param("viewer", viewer).query(Student.class).optional()
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Профиль студента не найден."));

        var now = clock.instant();
        List<Assignment> studentAssignments = db.sql("""
            SELECT a.id, a.title, a.deadline, w.status,
                   CASE WHEN u.email = :viewer THEN a.penalty_limit END AS penalty_limit,
                   CASE WHEN u.email = :viewer THEN w.deducted END AS deducted
            FROM student_work w JOIN assignment a ON a.id = w.assignment_id
            JOIN campus_user u ON u.id = w.student_id
            WHERE w.student_id = :id AND (NOT a.individual OR u.email = :viewer OR EXISTS (
                SELECT 1 FROM campus_user author WHERE author.id = a.teacher_id AND author.email = :viewer
            ))
            ORDER BY a.id DESC
            """).param("id", studentId).param("viewer", viewer).query((row, index) -> {
                var deadline = row.getObject("deadline", OffsetDateTime.class).toInstant();
                return new Assignment(row.getLong("id"), row.getString("title"), deadline,
                    AssignmentService.visibleStatus(row.getString("status"), deadline, now),
                    row.getObject("penalty_limit", Integer.class), row.getObject("deducted", Integer.class));
            }).list();
        List<RatingEntry> ratingHistory = db.sql("""
            SELECT r.id, 'AR' AS currency,
                   CASE WHEN a.individual AND NOT EXISTS (
                       SELECT 1 FROM campus_user actor WHERE actor.email = :viewer AND actor.id IN (r.student_id, a.teacher_id)
                   ) THEN NULL ELSE a.title END AS assignment_title, r.semester_start,
                   NULL::text AS activity_title, NULL::text AS teacher_name, r.amount, r.recorded_at
            FROM rating_entry r LEFT JOIN assignment a ON a.id = r.assignment_id
            WHERE r.student_id = :id
            UNION ALL
            SELECT award.id, CASE WHEN a.kind = 'PUBLIC' THEN 'BOA' ELSE 'BUA' END,
                   NULL, NULL, a.title, teacher.full_name, award.points, award.awarded_at
            FROM activity_award award JOIN activity a ON a.id = award.activity_id
            JOIN campus_user teacher ON teacher.id = a.teacher_id
            WHERE award.student_id = :id
            ORDER BY recorded_at DESC, currency, id DESC
            """).param("id", studentId).param("viewer", viewer).query((row, index) -> new RatingEntry(
                row.getLong("id"), row.getString("currency"), row.getString("assignment_title"),
                row.getObject("semester_start", LocalDate.class), row.getString("activity_title"),
                row.getString("teacher_name"), row.getBigDecimal("amount"),
                row.getObject("recorded_at", OffsetDateTime.class).toInstant())).list();
        return new Profile(student, new PersonalDetails(studentAssignments, ratingHistory));
    }
}

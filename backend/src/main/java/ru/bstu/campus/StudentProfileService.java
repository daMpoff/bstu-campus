package ru.bstu.campus;

import java.math.BigDecimal;
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
    private final AssignmentService assignments;

    StudentProfileService(JdbcClient db, AssignmentService assignments) {
        this.db = db;
        this.assignments = assignments;
    }

    record Student(long id, String fullName, String facultyName, String groupName, int rating,
                   BigDecimal academicActivityPoints, BigDecimal publicActivityPoints) {}
    record Assignment(long id, String title, Instant deadline, String status) {}
    record RatingEntry(long id, String currency, String assignmentTitle, LocalDate semesterStart,
                       String activityTitle, String teacherName, BigDecimal amount, Instant recordedAt) {}
    record PersonalDetails(List<Assignment> assignments, List<RatingEntry> ratingHistory) {}
    record Profile(Student student, PersonalDetails personal) {}

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    Profile profile(long studentId) {
        Student student = db.sql("""
            SELECT u.id, u.full_name, f.name AS faculty_name, g.name AS group_name, u.rating, points.*
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
            """).param("id", studentId).query(Student.class).optional()
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Профиль студента не найден."));

        List<Assignment> studentAssignments = assignments.studying(studentId).stream()
            .map(item -> new Assignment(item.id(), item.title(), item.deadline(), item.status())).toList();
        List<RatingEntry> ratingHistory = db.sql("""
            SELECT r.id, 'AR' AS currency, a.title AS assignment_title, r.semester_start,
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
            """).param("id", studentId).query((row, index) -> new RatingEntry(
                row.getLong("id"), row.getString("currency"), row.getString("assignment_title"),
                row.getObject("semester_start", LocalDate.class), row.getString("activity_title"),
                row.getString("teacher_name"), row.getBigDecimal("amount"),
                row.getObject("recorded_at", OffsetDateTime.class).toInstant())).list();
        return new Profile(student, new PersonalDetails(studentAssignments, ratingHistory));
    }
}

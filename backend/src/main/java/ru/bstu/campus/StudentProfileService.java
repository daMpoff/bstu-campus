package ru.bstu.campus;

import java.time.Instant;
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

    record Student(long id, String fullName, String facultyName, String groupName, int rating) {}
    record Assignment(long id, String title, Instant deadline, String status) {}
    record RatingEntry(long id, String assignmentTitle, int amount, Instant recordedAt) {}
    record PersonalDetails(List<Assignment> assignments, List<RatingEntry> ratingHistory) {}
    record Profile(Student student, PersonalDetails personal) {}

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    Profile profile(long studentId, String viewerEmail) {
        Student student = db.sql("""
            SELECT u.id, u.full_name, f.name AS faculty_name, g.name AS group_name, u.rating
            FROM campus_user u
            JOIN study_group g ON g.id = u.group_id
            LEFT JOIN faculty f ON f.id = COALESCE(u.faculty_id, g.faculty_id)
            WHERE u.id = :id AND u.role = 'STUDENT'
            """).param("id", studentId).query(Student.class).optional()
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Профиль студента не найден."));

        if (assignments.account(viewerEmail).id() != studentId) {
            return new Profile(student, null);
        }

        List<Assignment> studentAssignments = assignments.studying(studentId).stream()
            .map(item -> new Assignment(item.id(), item.title(), item.deadline(), item.status())).toList();
        List<RatingEntry> ratingHistory = db.sql("""
            SELECT r.id, a.title, r.amount, r.recorded_at
            FROM rating_entry r
            JOIN assignment a ON a.id = r.assignment_id
            WHERE r.student_id = :id
            ORDER BY r.recorded_at DESC, r.id DESC
            """).param("id", studentId).query((row, index) -> new RatingEntry(
                row.getLong("id"), row.getString("title"), row.getInt("amount"),
                row.getObject("recorded_at", OffsetDateTime.class).toInstant())).list();
        return new Profile(student, new PersonalDetails(studentAssignments, ratingHistory));
    }
}

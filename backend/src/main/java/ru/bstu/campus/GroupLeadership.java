package ru.bstu.campus;

import java.sql.Types;
import java.util.List;
import java.util.Objects;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
class GroupLeadership {
    private static final String APPROVAL_SCOPE = """
        (
            :role = 'ADMIN'
            OR (:role = 'TEACHER' AND EXISTS (
                SELECT 1 FROM group_responsible_teacher r WHERE r.group_id = g.id AND r.teacher_id = :viewer
            ))
            OR (:role = 'STUDENT' AND EXISTS (
                SELECT 1 FROM campus_user leader
                WHERE leader.id = :viewer AND leader.id = g.leader_student_id AND leader.group_id = g.id
                  AND leader.role = 'STUDENT' AND leader.email_verified AND leader.group_verified
            ))
        )
        """;

    private final JdbcClient db;

    GroupLeadership(JdbcClient db) {
        this.db = db;
    }

    record ApprovalGroup(long id, String name, Long facultyId, String facultyName, String studyForm, long pendingCount) {}
    record Member(long id, String fullName) {}
    record Leadership(Long leaderId, List<Member> students, List<Member> teachers, List<Long> teacherIds) {}

    List<ApprovalGroup> groups(AssignmentService.Account viewer) {
        return scoped("""
            SELECT g.id, g.name, g.faculty_id, f.name AS faculty_name, g.study_form,
                   COALESCE(p.pending_count, 0) AS pending_count
            FROM study_group g
            LEFT JOIN faculty f ON f.id = g.faculty_id
            LEFT JOIN (
                SELECT group_id, count(*) AS pending_count
                FROM campus_user
                WHERE role = 'STUDENT' AND email_verified AND NOT group_verified
                GROUP BY group_id
            ) p ON p.group_id = g.id
            WHERE
            """ + APPROVAL_SCOPE + " ORDER BY g.name, g.id", viewer).query(ApprovalGroup.class).list();
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    List<Member> pending(AssignmentService.Account viewer, long groupId) {
        requireApproval(viewer, groupId);
        return db.sql("""
            SELECT id, full_name FROM campus_user WHERE role = 'STUDENT' AND group_id = :group
              AND email_verified AND NOT group_verified
            ORDER BY full_name, id
            """).param("group", groupId).query(Member.class).list();
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    Leadership leadership(AssignmentService.Account viewer, long groupId) {
        requireManager(viewer, groupId);
        var students = db.sql("""
            SELECT id, full_name FROM campus_user WHERE role = 'STUDENT' AND group_id = :group
              AND email_verified AND group_verified
            ORDER BY full_name, id
            """).param("group", groupId).query(Member.class).list();
        Long leader = db.sql("SELECT leader_student_id FROM study_group WHERE id = :group AND leader_student_id IS NOT NULL")
            .param("group", groupId).query(Long.class).optional().orElse(null);
        if (!"ADMIN".equals(viewer.role())) return new Leadership(leader, students, List.of(), List.of());
        var teachers = db.sql("""
            SELECT id, full_name FROM campus_user WHERE role = 'TEACHER' AND email_verified ORDER BY full_name, id
            """).query(Member.class).list();
        var teacherIds = db.sql("""
            SELECT teacher_id FROM group_responsible_teacher WHERE group_id = :group ORDER BY teacher_id
            """).param("group", groupId).query(Long.class).list();
        return new Leadership(leader, students, teachers, teacherIds);
    }

    @Transactional
    void setLeader(AssignmentService.Account viewer, long groupId, Long studentId) {
        lockGroup(groupId);
        requireManager(viewer, groupId);
        if (studentId != null && !db.sql("""
            SELECT EXISTS (SELECT 1 FROM campus_user WHERE id = :student AND group_id = :group
                AND role = 'STUDENT' AND email_verified AND group_verified)
            """).param("student", studentId).param("group", groupId).query(Boolean.class).single()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Выберите подтверждённого студента этой группы.");
        }
        db.sql("UPDATE study_group SET leader_student_id = :student WHERE id = :group")
            .param("student", studentId, Types.BIGINT).param("group", groupId).update();
    }

    @Transactional
    void setResponsibleTeachers(AssignmentService.Account viewer, long groupId, List<Long> teacherIds) {
        if (!"ADMIN".equals(viewer.role())) throw denied();
        if (teacherIds == null || teacherIds.stream().anyMatch(Objects::isNull)) throw invalidTeachers();
        lockGroup(groupId);
        var ids = teacherIds.stream().distinct().toList();
        if (!ids.isEmpty() && db.sql("""
            SELECT count(*) FROM campus_user WHERE id IN (:teachers) AND role = 'TEACHER' AND email_verified
            """).param("teachers", ids).query(Long.class).single() != ids.size()) {
            throw invalidTeachers();
        }
        db.sql("DELETE FROM group_responsible_teacher WHERE group_id = :group").param("group", groupId).update();
        if (!ids.isEmpty()) {
            db.sql("""
                INSERT INTO group_responsible_teacher (group_id, teacher_id)
                SELECT :group, id FROM campus_user WHERE id IN (:teachers)
                """).param("group", groupId).param("teachers", ids).update();
        }
    }

    void requireApproval(AssignmentService.Account viewer, long groupId) {
        if (!scoped("SELECT EXISTS (SELECT 1 FROM study_group g WHERE g.id = :group AND " + APPROVAL_SCOPE + ")", viewer)
            .param("group", groupId).query(Boolean.class).single()) throw denied();
    }

    void lockGroup(long groupId) {
        if (db.sql("SELECT id FROM study_group WHERE id = :group FOR UPDATE").param("group", groupId)
            .query(Long.class).optional().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Учебная группа не найдена.");
        }
    }

    private void requireManager(AssignmentService.Account viewer, long groupId) {
        if ("STUDENT".equals(viewer.role())) throw denied();
        requireApproval(viewer, groupId);
    }

    private JdbcClient.StatementSpec scoped(String sql, AssignmentService.Account viewer) {
        return db.sql(sql).param("role", viewer.role()).param("viewer", viewer.id());
    }

    private static ResponseStatusException denied() {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, "У вас нет доступа к управлению этой группой.");
    }

    private static ResponseStatusException invalidTeachers() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "Выберите преподавателей с подтверждённой почтой.");
    }
}

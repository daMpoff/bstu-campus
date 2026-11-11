package ru.bstu.campus;

import java.sql.Types;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
class AssignmentService {
    private final JdbcClient db;
    private final Clock clock;
    private final Duration interval;

    AssignmentService(JdbcClient db, Clock clock, @Value("${campus.penalty.interval}") Duration interval) {
        this.db = db;
        this.clock = clock;
        this.interval = interval;
    }

    record Account(long id, String fullName, String role, String groupName, int rating,
                   String facultyName, String departmentName) {}
    record Group(long id, String name) {}
    record Assignment(long id, String title, String description, Instant deadline, int penaltyLimit,
                      List<String> groups, int total, int accepted, int waiting) {}
    record PendingWork(long assignmentId, String assignmentTitle, long studentId, String studentName,
                       String groupName, String link, String fileName) {}
    record TeacherDashboard(List<Assignment> assignments, List<PendingWork> pendingWorks) {}
    record RankedStudent(long id, String fullName, int rating) {}
    record Work(long studentId, String studentName, String groupName, String status, String link,
                String fileName, int deducted) {}
    record StudentAssignment(long id, String title, String description, Instant deadline, int penaltyLimit,
                             String teacherName, String status, String link, String fileName, int deducted) {}
    record Attachment(String name, byte[] content) {}

    Account account(String email) {
        return db.sql("""
            SELECT u.id, u.full_name, u.role, g.name, u.rating, f.name, d.name
            FROM campus_user u
            LEFT JOIN study_group g ON g.id = u.group_id
            LEFT JOIN department d ON d.id = u.department_id
            LEFT JOIN faculty f ON f.id = COALESCE(u.faculty_id, d.faculty_id)
            WHERE u.email = :email
            """).param("email", email).query((row, index) -> new Account(row.getLong(1), row.getString(2),
                row.getString(3), row.getString(4), row.getInt(5), row.getString(6), row.getString(7))).optional()
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
    }

    List<Group> groups() {
        return db.sql("SELECT id, name FROM study_group ORDER BY (study_form IS NOT NULL), name")
            .query(Group.class).list();
    }

    List<Assignment> teaching(long teacher) {
        return db.sql("""
            SELECT a.*, ARRAY(
                SELECT g.name FROM assignment_group ag JOIN study_group g ON g.id = ag.group_id
                WHERE ag.assignment_id = a.id ORDER BY g.name
            ) AS groups, progress.*
            FROM assignment a
            CROSS JOIN LATERAL (
                SELECT count(*) AS total, count(*) FILTER (WHERE status = 'ACCEPTED') AS accepted,
                       count(*) FILTER (WHERE status = 'SUBMITTED') AS waiting
                FROM student_work WHERE assignment_id = a.id
            ) progress
            WHERE a.teacher_id = :teacher ORDER BY a.id DESC
            """).param("teacher", teacher).query((row, index) -> new Assignment(row.getLong("id"),
                row.getString("title"), row.getString("description"), row.getObject("deadline", OffsetDateTime.class).toInstant(),
                row.getInt("penalty_limit"), List.of((String[]) row.getArray("groups").getArray()),
                row.getInt("total"), row.getInt("accepted"), row.getInt("waiting"))).list();
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    TeacherDashboard dashboard(long teacher) {
        List<PendingWork> pending = db.sql("""
            SELECT a.id, a.title, u.id, u.full_name, g.name, w.work_link, w.file_name
            FROM student_work w JOIN assignment a ON a.id = w.assignment_id
            JOIN campus_user u ON u.id = w.student_id JOIN study_group g ON g.id = u.group_id
            WHERE a.teacher_id = :teacher AND w.status = 'SUBMITTED'
            ORDER BY w.submitted_at DESC, a.id DESC, u.id
            """).param("teacher", teacher).query((row, index) -> new PendingWork(
                row.getLong(1), row.getString(2), row.getLong(3), row.getString(4), row.getString(5),
                row.getString(6), row.getString(7))).list();
        return new TeacherDashboard(teaching(teacher), pending);
    }

    List<RankedStudent> ranking(long group) {
        if (db.sql("SELECT id FROM study_group WHERE id = :group")
                .param("group", group).query(Long.class).optional().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Учебная группа не найдена.");
        }
        return db.sql("""
            SELECT id, full_name, rating FROM campus_user
            WHERE group_id = :group AND role = 'STUDENT'
            ORDER BY rating DESC, full_name, id
            """).param("group", group).query(RankedStudent.class).list();
    }

    @Transactional
    long create(long teacher, AssignmentController.NewAssignment input) {
        String title = input.title() == null ? "" : input.title().strip();
        String description = input.description() == null ? "" : input.description().strip();
        Integer limit = input.penaltyLimit();
        List<Long> groups = input.groupIds() == null ? List.of() : input.groupIds().stream().distinct().toList();
        if (title.isEmpty() || title.length() > 160 || description.isEmpty() || description.length() > 5000
                || input.deadline() == null || limit == null || limit < 0 || limit > 1000 || groups.isEmpty()
                || groups.contains(null)) {
            throw badRequest("Заполните название, описание, группы, дедлайн и лимит списания от 0 до 1000.");
        }
        var lockedGroups = db.sql("SELECT id FROM study_group WHERE id IN (:groups) ORDER BY id FOR UPDATE")
            .param("groups", groups).query(Long.class).list();
        if (lockedGroups.size() != groups.size()) {
            throw badRequest("Выберите группы из списка.");
        }
        long id = db.sql("""
            INSERT INTO assignment (teacher_id, title, description, deadline, penalty_limit)
            VALUES (:teacher, :title, :description, :deadline, :limit) RETURNING id
            """).param("teacher", teacher).param("title", title).param("description", description)
            .param("deadline", timestamp(input.deadline())).param("limit", limit).query(Long.class).single();
        db.sql("""
            INSERT INTO assignment_group (assignment_id, group_id)
            SELECT :id, id FROM study_group WHERE id IN (:groups)
            """).param("id", id).param("groups", groups).update();
        db.sql("""
            INSERT INTO student_work (assignment_id, student_id, next_penalty_at)
            SELECT :id, id, :next FROM campus_user WHERE role = 'STUDENT' AND group_id IN (:groups)
            """).param("id", id).param("next", timestamp(input.deadline().plus(interval)))
            .param("groups", groups).update();
        return id;
    }

    List<Work> works(long teacher, long assignment) {
        ownedBy(teacher, assignment);
        Instant now = clock.instant();
        return db.sql("""
            SELECT w.*, u.full_name, g.name, a.deadline
            FROM student_work w JOIN campus_user u ON u.id = w.student_id
            JOIN study_group g ON g.id = u.group_id JOIN assignment a ON a.id = w.assignment_id
            WHERE w.assignment_id = :id ORDER BY g.name, u.full_name
            """).param("id", assignment).query((row, index) -> new Work(row.getLong("student_id"),
                row.getString("full_name"), row.getString("name"),
                visibleStatus(row.getString("status"), row.getObject("deadline", OffsetDateTime.class).toInstant(), now),
                row.getString("work_link"), row.getString("file_name"), row.getInt("deducted"))).list();
    }

    List<StudentAssignment> studying(long student) {
        Instant now = clock.instant();
        return db.sql("""
            SELECT a.*, u.full_name, w.status, w.work_link, w.file_name, w.deducted
            FROM student_work w JOIN assignment a ON a.id = w.assignment_id
            JOIN campus_user u ON u.id = a.teacher_id
            WHERE w.student_id = :student ORDER BY a.id DESC
            """).param("student", student).query((row, index) -> {
                Instant deadline = row.getObject("deadline", OffsetDateTime.class).toInstant();
                return new StudentAssignment(row.getLong("id"), row.getString("title"), row.getString("description"),
                    deadline, row.getInt("penalty_limit"), row.getString("full_name"),
                    visibleStatus(row.getString("status"), deadline, now),
                    row.getString("work_link"), row.getString("file_name"), row.getInt("deducted"));
            }).list();
    }

    @Transactional
    void review(long teacher, long assignment, AssignmentController.Review input) {
        ownedBy(teacher, assignment);
        if (input.studentIds() == null || input.studentIds().isEmpty() || input.studentIds().stream().anyMatch(id -> id == null)
                || !("ACCEPTED".equals(input.action()) || "RETURNED".equals(input.action()))) {
            throw badRequest("Выберите работы и действие.");
        }
        List<Long> ids = input.studentIds().stream().distinct().toList();
        List<String> states = db.sql("""
            SELECT status FROM student_work WHERE assignment_id = :id AND student_id IN (:students)
            ORDER BY student_id FOR UPDATE
            """).param("id", assignment).param("students", ids).query(String.class).list();
        if (states.size() != ids.size() || states.stream().anyMatch(status -> !"SUBMITTED".equals(status))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Проверять можно только сданные работы.");
        }
        db.sql("""
            UPDATE student_work w SET status = :status, next_penalty_at = GREATEST(a.deadline, :now) + CAST(:interval AS interval)
            FROM assignment a WHERE w.assignment_id = a.id AND w.assignment_id = :id AND w.student_id IN (:students)
            """).param("status", input.action()).param("now", timestamp(clock.instant()))
            .param("interval", interval.toMillis() + " milliseconds").param("id", assignment).param("students", ids).update();
    }

    @Transactional
    void submit(long student, long assignment, String link, String fileName, byte[] content) {
        String state = db.sql("""
            SELECT status FROM student_work WHERE assignment_id = :id AND student_id = :student FOR UPDATE
            """).param("id", assignment).param("student", student).query(String.class).optional()
            .orElseThrow(AssignmentService::notFound);
        if (!("OPEN".equals(state) || "RETURNED".equals(state))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Эта работа уже сдана.");
        }
        db.sql("""
            UPDATE student_work SET status = 'SUBMITTED', work_link = :link, file_name = :fileName,
                file_content = :content, submitted_at = :now WHERE assignment_id = :id AND student_id = :student
            """).param("link", link, Types.VARCHAR).param("fileName", fileName, Types.VARCHAR)
            .param("content", content, Types.BINARY).param("now", timestamp(clock.instant()))
            .param("id", assignment).param("student", student).update();
    }

    Attachment attachment(Account account, long assignment, long student) {
        return db.sql("""
            SELECT w.file_name, w.file_content FROM student_work w JOIN assignment a ON a.id = w.assignment_id
            WHERE w.assignment_id = :id AND w.student_id = :student AND w.file_name IS NOT NULL
              AND ((:role = 'TEACHER' AND a.teacher_id = :user) OR (:role = 'STUDENT' AND w.student_id = :user))
            """).param("id", assignment).param("student", student).param("role", account.role()).param("user", account.id())
            .query((row, index) -> new Attachment(row.getString(1), row.getBytes(2))).optional()
            .orElseThrow(AssignmentService::notFound);
    }

    private void ownedBy(long teacher, long assignment) {
        db.sql("SELECT id FROM assignment WHERE id = :id AND teacher_id = :teacher")
            .param("id", assignment).param("teacher", teacher).query(Long.class).optional()
            .orElseThrow(AssignmentService::notFound);
    }

    static OffsetDateTime timestamp(Instant value) {
        return value.atOffset(ZoneOffset.UTC);
    }

    private static String visibleStatus(String status, Instant deadline, Instant now) {
        return "OPEN".equals(status) && !now.isBefore(deadline) ? "OVERDUE" : status;
    }

    private static ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Задание или файл недоступны.");
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}

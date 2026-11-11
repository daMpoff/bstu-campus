package ru.bstu.campus;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
class ActivityService {
    private static final ZoneId MOSCOW = ZoneId.of("Europe/Moscow");
    private static final Set<Integer> LEVELS = Set.of(25, 50, 75, 100);
    private static final String ACTIVITY_FIELDS = """
        a.id, a.title, a.description, a.occurs_at, a.max_points, a.kind, a.attendance_format, t.full_name AS teacher_name,
        ARRAY(SELECT g.name FROM activity_group ag JOIN study_group g ON g.id = ag.group_id
              WHERE ag.activity_id = a.id ORDER BY g.name) AS groups
        """;
    private static final String ACTIVITY_FROM = " FROM activity a JOIN campus_user t ON t.id = a.teacher_id ";

    private final JdbcClient db;
    private final Clock clock;
    private final CampusSettings settings;

    ActivityService(JdbcClient db, Clock clock, CampusSettings settings) {
        this.db = db;
        this.clock = clock;
        this.settings = settings;
    }

    enum Kind { ACADEMIC, PUBLIC }
    enum Format { IN_PERSON, REMOTE }
    record NewActivity(String title, String description, List<Long> groupIds, Instant occursAt, Integer maxPoints,
                       Kind kind, Format format) {}
    record Activity(long id, String title, String description, Instant occursAt, int maxPoints,
                    Kind kind, Format format, String teacherName, List<String> groups) {}
    record StudentActivity(Activity activity, boolean enrolled, boolean canEnroll, Integer participation, BigDecimal points) {}
    record Participant(long studentId, String studentName, String groupName, Integer participation, BigDecimal points) {}
    record Budget(long groupId, String groupName, BigDecimal spent, BigDecimal remaining, int limit, int awards) {}
    record Detail(Activity activity, boolean canConfirm, LocalDate budgetMonth, List<Participant> participants, List<Budget> budgets) {}
    record Reward(long id, long studentId, String studentName, String activityTitle, Kind kind, BigDecimal points, Instant awardedAt) {}
    record RewardPage(List<Reward> entries, Long nextBeforeId) {}

    private record EnrollmentTarget(Kind kind, Instant occursAt, long groupId) {}

    List<Activity> teaching(long teacher) {
        return db.sql("SELECT " + ACTIVITY_FIELDS + ACTIVITY_FROM
                + "WHERE a.teacher_id = :teacher ORDER BY a.occurs_at DESC, a.id DESC")
            .param("teacher", teacher).query((row, index) -> activity(row)).list();
    }

    List<StudentActivity> studying(long student) {
        Instant now = clock.instant();
        return db.sql("SELECT " + ACTIVITY_FIELDS + ", award.participation, award.points, "
            + "enrollment.student_id IS NOT NULL AS enrolled " + ACTIVITY_FROM + """
            JOIN activity_group target ON target.activity_id = a.id
            JOIN campus_user u ON u.group_id = target.group_id AND u.id = :student AND u.group_verified AND u.email_verified
            LEFT JOIN activity_award award ON award.activity_id = a.id AND award.student_id = u.id
            LEFT JOIN activity_enrollment enrollment ON enrollment.activity_id = a.id AND enrollment.student_id = u.id
            ORDER BY a.occurs_at DESC, a.id DESC
            """).param("student", student).query((row, index) -> {
                Activity activity = activity(row);
                boolean enrolled = row.getBoolean("enrolled");
                boolean canEnroll = activity.kind() == Kind.PUBLIC && !enrolled && now.isBefore(activity.occursAt());
                return new StudentActivity(activity, enrolled, canEnroll, row.getObject("participation", Integer.class),
                    row.getBigDecimal("points"));
            }).list();
    }

    @Transactional
    long create(long teacher, NewActivity input) {
        String title = input.title() == null ? "" : input.title().strip();
        String description = input.description() == null ? "" : input.description().strip();
        List<Long> groups = input.groupIds() == null ? List.of() : input.groupIds().stream().distinct().toList();
        if (title.isEmpty() || title.length() > 160 || description.isEmpty() || description.length() > 5000
                || groups.isEmpty() || groups.stream().anyMatch(id -> id == null || id < 1)
                || input.maxPoints() == null || input.maxPoints() < 1) {
            throw badRequest("Укажите название, описание, учебные группы и максимальное число баллов.");
        }
        if (input.occursAt() == null || !input.occursAt().isAfter(clock.instant())) {
            throw badRequest("Дата проведения должна быть в будущем.");
        }
        long known = db.sql("SELECT count(*) FROM study_group WHERE id IN (:groups)")
            .param("groups", groups).query(Long.class).single();
        if (known != groups.size()) {
            throw badRequest("Выберите учебные группы из списка.");
        }
        Kind kind = input.kind() == null ? Kind.ACADEMIC : input.kind();
        long id = db.sql("""
            INSERT INTO activity (teacher_id, title, description, occurs_at, max_points, kind, attendance_format)
            VALUES (:teacher, :title, :description, :date, :points, :kind, :format) RETURNING id
            """).param("teacher", teacher).param("title", title).param("description", description)
            .param("date", AssignmentService.timestamp(input.occursAt())).param("points", input.maxPoints())
            .param("kind", kind.name())
            .param("format", input.format() == null ? null : input.format().name(), Types.VARCHAR)
            .query(Long.class).single();
        db.sql("""
            INSERT INTO activity_group (activity_id, group_id)
            SELECT :activity, id FROM study_group WHERE id IN (:groups)
            """).param("activity", id).param("groups", groups).update();
        return id;
    }

    @Transactional
    void enroll(long student, long activityId) {
        EnrollmentTarget target = db.sql("""
            SELECT a.kind, a.occurs_at, u.group_id
            FROM campus_user u JOIN activity_group ag ON ag.group_id = u.group_id
            JOIN activity a ON a.id = ag.activity_id
            WHERE u.id = :student AND u.role = 'STUDENT' AND u.group_verified AND u.email_verified AND a.id = :activity
            """).param("student", student).param("activity", activityId).query((row, index) -> new EnrollmentTarget(
                Kind.valueOf(row.getString(1)), row.getObject(2, OffsetDateTime.class).toInstant(), row.getLong(3)))
            .optional().orElseThrow(() -> notFound("Активность недоступна вашей группе."));
        if (target.kind() != Kind.PUBLIC) {
            throw badRequest("Запись доступна для общественных активностей.");
        }
        Instant now = clock.instant();
        if (!now.isBefore(target.occursAt())) {
            throw conflict("Запись закрылась в момент начала активности.");
        }
        db.sql("""
            INSERT INTO activity_enrollment (activity_id, student_id, group_id, enrolled_at)
            VALUES (:activity, :student, :group, :now)
            ON CONFLICT (activity_id, student_id) DO NOTHING
            """).param("activity", activityId).param("student", student).param("group", target.groupId())
            .param("now", AssignmentService.timestamp(now)).update();
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    Detail detail(long teacher, long id) {
        Activity activity = ownedActivity(teacher, id);
        Instant now = clock.instant();
        LocalDate month = budgetMonth(now);
        int monthlyLimit = settings.current().activityMonthlyLimit();
        String roster = activity.kind() == Kind.PUBLIC ? """
            JOIN activity_enrollment enrollment ON enrollment.activity_id = ag.activity_id AND enrollment.group_id = ag.group_id
            JOIN campus_user u ON u.id = enrollment.student_id AND u.role = 'STUDENT'
            """ : " JOIN campus_user u ON u.group_id = g.id AND u.role = 'STUDENT' AND u.group_verified AND u.email_verified ";
        List<Participant> participants = db.sql("""
            SELECT u.id, u.full_name, g.name, award.participation, award.points
            FROM activity_group ag JOIN study_group g ON g.id = ag.group_id
            """ + roster + """
            LEFT JOIN activity_award award ON award.activity_id = ag.activity_id AND award.student_id = u.id
            WHERE ag.activity_id = :activity ORDER BY g.name, u.full_name, u.id
            """).param("activity", id).query((row, index) -> new Participant(
                row.getLong(1), row.getString(2), row.getString(3),
                row.getObject(4, Integer.class), row.getBigDecimal(5))).list();
        List<Budget> budgets = db.sql("""
            SELECT g.id, g.name, COALESCE(b.spent, 0), COALESCE(b.awards, 0)
            FROM activity_group ag JOIN study_group g ON g.id = ag.group_id
            LEFT JOIN teacher_group_budget b ON b.group_id = g.id AND b.teacher_id = :teacher AND b.month_start = :month
            WHERE ag.activity_id = :activity ORDER BY g.name
            """).param("activity", id).param("teacher", teacher).param("month", month).query((row, index) -> {
                BigDecimal spent = row.getBigDecimal(3);
                BigDecimal remaining = BigDecimal.valueOf(monthlyLimit).subtract(spent).max(BigDecimal.ZERO);
                return new Budget(row.getLong(1), row.getString(2), spent, remaining, monthlyLimit, row.getInt(4));
            }).list();
        return new Detail(activity, !now.isBefore(activity.occursAt()), month, participants, budgets);
    }

    @Transactional
    void confirm(long teacher, long activityId, long student, BigDecimal participation) {
        Activity activity = ownedActivity(teacher, activityId);
        Instant now = clock.instant();
        if (now.isBefore(activity.occursAt())) {
            throw conflict("Подтвердить участие можно после наступления даты проведения.");
        }
        int level = participationLevel(participation);
        BigDecimal points = awardPoints(activity.maxPoints(), level);
        long group = participantGroup(activity, student);

        int inserted = db.sql("""
            INSERT INTO activity_award (activity_id, student_id, group_id, participation, points, awarded_at)
            VALUES (:activity, :student, :group, :level, :points, :now)
            ON CONFLICT (activity_id, student_id) DO NOTHING
            """).param("activity", activityId).param("student", student).param("group", group)
            .param("level", level).param("points", points).param("now", AssignmentService.timestamp(now)).update();
        if (inserted == 0) {
            throw conflict("Участие этого студента уже подтверждено.");
        }

        LocalDate month = budgetMonth(now);
        db.sql("""
            INSERT INTO teacher_group_budget (teacher_id, group_id, month_start)
            VALUES (:teacher, :group, :month) ON CONFLICT DO NOTHING
            """).param("teacher", teacher).param("group", group).param("month", month).update();
        int charged = db.sql("""
            UPDATE teacher_group_budget SET spent = spent + :points, awards = awards + 1
            WHERE teacher_id = :teacher AND group_id = :group AND month_start = :month
              AND spent + :points <= :limit
            """).param("teacher", teacher).param("group", group).param("month", month)
            .param("points", points).param("limit", settings.current().activityMonthlyLimit()).update();
        if (charged == 0) {
            throw conflict("Месячного бюджета этой группы не хватает для начисления.");
        }
    }

    private long participantGroup(Activity activity, long student) {
        if (activity.kind() == Kind.PUBLIC) {
            return db.sql("""
                SELECT group_id FROM activity_enrollment WHERE activity_id = :activity AND student_id = :student
                """).param("activity", activity.id()).param("student", student).query(Long.class).optional()
                .orElseThrow(() -> conflict("БОА можно начислить только записавшимся студентам."));
        }
        return db.sql("""
            SELECT u.group_id FROM campus_user u JOIN activity_group ag ON ag.group_id = u.group_id
            WHERE u.id = :student AND u.role = 'STUDENT' AND u.group_verified AND u.email_verified AND ag.activity_id = :activity
            """).param("student", student).param("activity", activity.id()).query(Long.class).optional()
            .orElseThrow(() -> notFound("Студент не входит в группы этой активности."));
    }

    RewardPage rewards(Long beforeId) {
        int pageSize = 30;
        var query = db.sql("""
            SELECT award.id, u.id, u.full_name, a.title, a.kind, award.points, award.awarded_at
            FROM activity_award award JOIN campus_user u ON u.id = award.student_id
            JOIN activity a ON a.id = award.activity_id
            """ + (beforeId == null ? "" : """
            WHERE (award.awarded_at, award.id) < (SELECT awarded_at, id FROM activity_award WHERE id = :before)
            """) + "ORDER BY award.awarded_at DESC, award.id DESC LIMIT :limit").param("limit", pageSize + 1);
        if (beforeId != null) query.param("before", beforeId);
        List<Reward> rows = query.query((row, index) -> new Reward(row.getLong(1), row.getLong(2),
            row.getString(3), row.getString(4), Kind.valueOf(row.getString(5)), row.getBigDecimal(6),
            row.getObject(7, OffsetDateTime.class).toInstant())).list();
        if (rows.size() > pageSize) {
            return new RewardPage(rows.subList(0, pageSize), rows.get(pageSize - 1).id());
        }
        return new RewardPage(rows, null);
    }

    private Activity ownedActivity(long teacher, long id) {
        return db.sql("SELECT " + ACTIVITY_FIELDS + ACTIVITY_FROM + "WHERE a.teacher_id = :teacher AND a.id = :id")
            .param("teacher", teacher).param("id", id).query((row, index) -> activity(row)).optional()
            .orElseThrow(() -> notFound("Активность не найдена."));
    }

    private static Activity activity(ResultSet row) throws SQLException {
        String format = row.getString("attendance_format");
        return new Activity(row.getLong("id"), row.getString("title"), row.getString("description"),
            row.getObject("occurs_at", OffsetDateTime.class).toInstant(), row.getInt("max_points"),
            Kind.valueOf(row.getString("kind")), format == null ? null : Format.valueOf(format), row.getString("teacher_name"),
            List.of((String[]) row.getArray("groups").getArray()));
    }

    static LocalDate budgetMonth(Instant now) {
        return now.atZone(MOSCOW).toLocalDate().withDayOfMonth(1);
    }

    static BigDecimal awardPoints(int maximum, int level) {
        return BigDecimal.valueOf(maximum).multiply(BigDecimal.valueOf(level)).movePointLeft(2);
    }

    static int participationLevel(BigDecimal participation) {
        if (participation != null) {
            try {
                int level = participation.intValueExact();
                if (LEVELS.contains(level)) return level;
            } catch (ArithmeticException ignored) {
                // Only the four exact percentages are valid.
            }
        }
        throw badRequest("Выберите участие 25%, 50%, 75% или 100%.");
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    private static ResponseStatusException conflict(String message) {
        return new ResponseStatusException(HttpStatus.CONFLICT, message);
    }

    private static ResponseStatusException notFound(String message) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, message);
    }
}

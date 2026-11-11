package ru.bstu.campus;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
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
class AnalyticsService {
    private static final ZoneId MOSCOW = ZoneId.of("Europe/Moscow");
    private static final Set<Integer> PERIODS = Set.of(3, 6, 12);
    private static final String MONTHS = """
        WITH months AS (
            SELECT generate_series(CAST(:first AS timestamp), CAST(:last AS timestamp), interval '1 month')::date AS month_start
        )
        """;

    record RatingMonth(LocalDate monthStart, BigDecimal averageRating) {}
    record Student(long id, String fullName, BigDecimal academicPoints, BigDecimal publicPoints) {}
    record BudgetMonth(LocalDate monthStart, BigDecimal spent, int awards, BigDecimal academicPoints, BigDecimal publicPoints) {}
    record Report(AssignmentService.Group group, int monthlyLimit, List<RatingMonth> rating,
                  List<Student> students, List<BudgetMonth> budget) {}

    private final JdbcClient db;
    private final Clock clock;
    private final CampusSettings settings;

    AnalyticsService(JdbcClient db, Clock clock, CampusSettings settings) {
        this.db = db;
        this.clock = clock;
        this.settings = settings;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    Report report(long teacher, long groupId, int months) {
        if (!PERIODS.contains(months)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Выберите 3, 6 или 12 месяцев.");
        }
        var group = db.sql("SELECT id, name FROM study_group WHERE id = :group").param("group", groupId)
            .query(AssignmentService.Group.class).optional()
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Учебная группа не найдена."));
        LocalDate last = LocalDate.now(clock.withZone(MOSCOW)).withDayOfMonth(1);
        LocalDate first = last.minusMonths(months - 1L);
        return new Report(group, settings.current().activityMonthlyLimit(), rating(groupId, first, last),
            students(groupId), budget(teacher, groupId, first, last));
    }

    private List<RatingMonth> rating(long group, LocalDate first, LocalDate last) {
        // Reverse later ledger changes to reconstruct each month's balance for the current group roster.
        return db.sql(MONTHS + """
            SELECT m.month_start, round(avg(u.rating - COALESCE(later.delta, 0)), 1) AS average_rating
            FROM months m LEFT JOIN campus_user u ON u.group_id = :group AND u.role = 'STUDENT'
                AND u.email_verified AND u.group_verified
            LEFT JOIN LATERAL (
                SELECT sum(r.amount) AS delta FROM rating_entry r WHERE r.student_id = u.id
                  AND r.recorded_at >= ((m.month_start + interval '1 month') AT TIME ZONE 'Europe/Moscow')
            ) later ON true
            GROUP BY m.month_start ORDER BY m.month_start
            """).param("group", group).param("first", first).param("last", last).query(RatingMonth.class).list();
    }

    private List<Student> students(long group) {
        return db.sql("""
            SELECT u.id, u.full_name, points.* FROM campus_user u
            CROSS JOIN LATERAL (
                SELECT COALESCE(sum(aw.points) FILTER (WHERE a.kind = 'ACADEMIC'), 0) AS academic_points,
                       COALESCE(sum(aw.points) FILTER (WHERE a.kind = 'PUBLIC'), 0) AS public_points
                FROM activity_award aw JOIN activity a ON a.id = aw.activity_id WHERE aw.student_id = u.id
            ) points
            WHERE u.role = 'STUDENT' AND u.group_id = :group AND u.email_verified AND u.group_verified
            ORDER BY academic_points DESC, u.full_name, u.id
            """).param("group", group).query(Student.class).list();
    }

    private List<BudgetMonth> budget(long teacher, long group, LocalDate first, LocalDate last) {
        return db.sql(MONTHS + """
            , points AS (
                SELECT date_trunc('month', aw.awarded_at AT TIME ZONE 'Europe/Moscow')::date AS month_start,
                       sum(aw.points) FILTER (WHERE a.kind = 'ACADEMIC') AS academic_points,
                       sum(aw.points) FILTER (WHERE a.kind = 'PUBLIC') AS public_points
                FROM activity_award aw JOIN activity a ON a.id = aw.activity_id
                WHERE a.teacher_id = :teacher AND aw.group_id = :group
                  AND aw.awarded_at >= (CAST(:first AS timestamp) AT TIME ZONE 'Europe/Moscow')
                  AND aw.awarded_at < ((CAST(:last AS date) + interval '1 month') AT TIME ZONE 'Europe/Moscow')
                GROUP BY 1
            )
            SELECT m.month_start, COALESCE(b.spent, 0) AS spent, COALESCE(b.awards, 0) AS awards,
                   COALESCE(p.academic_points, 0) AS academic_points, COALESCE(p.public_points, 0) AS public_points
            FROM months m LEFT JOIN teacher_group_budget b
                ON b.month_start = m.month_start AND b.teacher_id = :teacher AND b.group_id = :group
            LEFT JOIN points p ON p.month_start = m.month_start
            ORDER BY m.month_start DESC
            """).param("teacher", teacher).param("group", group).param("first", first).param("last", last)
            .query(BudgetMonth.class).list();
    }
}

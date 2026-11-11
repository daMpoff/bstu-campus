package ru.bstu.campus;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
class StudentDeadlineService {
    static final String SUMMARY_TOOL = "get_my_deadlines_and_rating";
    static final String DEFAULT_PERIOD = "this_week";
    static final Map<String, Period> PERIODS = Map.of(
        "active", Period.ACTIVE, DEFAULT_PERIOD, Period.THIS_WEEK,
        "next_week", Period.NEXT_WEEK, "next_7_days", Period.NEXT_7_DAYS);

    private static final ZoneId MOSCOW = ZoneId.of("Europe/Moscow");
    private static final int DEADLINE_LIMIT = 12;
    private static final int HISTORY_LIMIT = 5;

    private final AssignmentService assignments;
    private final JdbcClient db;
    private final Clock clock;

    StudentDeadlineService(AssignmentService assignments, JdbcClient db, Clock clock) {
        this.assignments = assignments;
        this.db = db;
        this.clock = clock;
    }

    enum Period { ACTIVE, THIS_WEEK, NEXT_WEEK, NEXT_7_DAYS }

    record DateRange(LocalDate startDate, LocalDate endDate) {}
    record Deadline(long id, String title, Instant deadline, String status, int deducted) {}
    record RatingChange(int amount, Instant recordedAt, String assignmentTitle, LocalDate semesterStart) {}
    record Summary(DateRange period, int rating, List<Deadline> assignments, List<Deadline> overdue,
                   List<RatingChange> ratingHistory, long assignmentsTotal, long overdueTotal) {}

    private record DeadlineRow(Deadline deadline, boolean earlierOverdue, long total) {}

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    Summary summary(String studentEmail, Period period) {
        var account = assignments.account(studentEmail);
        if (!"STUDENT".equals(account.role())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }

        Instant now = clock.instant();
        LocalDate today = now.atZone(MOSCOW).toLocalDate();
        LocalDate monday = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDate start = switch (period) {
            case THIS_WEEK -> monday;
            case NEXT_WEEK -> monday.plusWeeks(1);
            case ACTIVE, NEXT_7_DAYS -> today;
        };
        LocalDate end = start.plusDays(7);
        boolean active = period == Period.ACTIVE;
        var rows = deadlines(account.id(), now, start.atStartOfDay(MOSCOW).toInstant(),
            end.atStartOfDay(MOSCOW).toInstant(), active);
        var inPeriod = rows.stream().filter(row -> !row.earlierOverdue()).toList();
        var overdue = rows.stream().filter(DeadlineRow::earlierOverdue).toList();
        return new Summary(active ? null : new DateRange(start, end.minusDays(1)), account.rating(),
            inPeriod.stream().map(DeadlineRow::deadline).toList(), overdue.stream().map(DeadlineRow::deadline).toList(),
            history(account.id()), total(inPeriod), total(overdue));
    }

    private List<DeadlineRow> deadlines(long student, Instant now, Instant start, Instant end, boolean active) {
        return db.sql("""
            WITH matching AS (
                SELECT a.id, a.title, a.deadline, w.status, w.deducted,
                       CASE WHEN :active THEN a.deadline <= :now AND w.status IN ('OPEN', 'RETURNED')
                            ELSE a.deadline < :start END AS earlier_overdue
                FROM student_work w JOIN assignment a ON a.id = w.assignment_id
                WHERE w.student_id = :student AND (
                    (:active AND w.status <> 'ACCEPTED')
                    OR (NOT :active AND a.deadline < :end AND
                        (a.deadline >= :start OR (a.deadline <= :now AND w.status IN ('OPEN', 'RETURNED'))))
                )
            ), ranked AS (
                SELECT matching.*, count(*) OVER (PARTITION BY earlier_overdue) AS total,
                       row_number() OVER (PARTITION BY earlier_overdue ORDER BY deadline, id) AS position
                FROM matching
            )
            SELECT id, title, deadline, status, deducted, earlier_overdue, total FROM ranked
            WHERE position <= :limit
            ORDER BY earlier_overdue, position
            """).param("student", student).param("now", AssignmentService.timestamp(now)).param("active", active)
            .param("start", AssignmentService.timestamp(start)).param("end", AssignmentService.timestamp(end))
            .param("limit", DEADLINE_LIMIT).query((row, index) -> {
                var deadline = row.getObject("deadline", OffsetDateTime.class).toInstant();
                var assignment = new Deadline(row.getLong("id"), row.getString("title"), deadline,
                    AssignmentService.visibleStatus(row.getString("status"), deadline, now), row.getInt("deducted"));
                return new DeadlineRow(assignment, row.getBoolean("earlier_overdue"), row.getLong("total"));
            }).list();
    }

    private List<RatingChange> history(long student) {
        return db.sql("""
            SELECT r.amount, r.recorded_at, a.title, r.semester_start
            FROM rating_entry r LEFT JOIN assignment a ON a.id = r.assignment_id
            WHERE r.student_id = :student
            ORDER BY r.recorded_at DESC, r.id DESC LIMIT :limit
            """).param("student", student).param("limit", HISTORY_LIMIT).query((row, index) ->
                new RatingChange(row.getInt("amount"), row.getObject("recorded_at", OffsetDateTime.class).toInstant(),
                    row.getString("title"), row.getObject("semester_start", LocalDate.class))).list();
    }

    private static long total(List<DeadlineRow> rows) {
        return rows.isEmpty() ? 0 : rows.getFirst().total();
    }
}

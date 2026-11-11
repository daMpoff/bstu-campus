package ru.bstu.campus;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Component
class RatingScheduler {
    private final JdbcClient db;
    private final TransactionTemplate transaction;
    private final Clock clock;
    private final CampusSettings settings;

    RatingScheduler(JdbcClient db, TransactionTemplate transaction, Clock clock, CampusSettings settings) {
        this.db = db;
        this.transaction = transaction;
        this.clock = clock;
        this.settings = settings;
    }

    private record Due(long assignment, long student, int deducted, int limit, Instant nextPenaltyAt) {}
    record Charge(int amount, Instant nextPenaltyAt) {}

    @Scheduled(fixedDelayString = "${campus.penalty.poll-delay:2s}")
    void applyDuePenalties() {
        CampusSettings.Values policy = settings.current();
        for (int processed = 0; processed < 500; processed++) {
            if (!Boolean.TRUE.equals(transaction.execute(status -> chargeNext(policy)))) {
                return;
            }
        }
    }

    private boolean chargeNext(CampusSettings.Values policy) {
        var now = clock.instant();
        var due = db.sql("""
            SELECT w.assignment_id, w.student_id, w.deducted, a.penalty_limit, w.next_penalty_at
            FROM student_work w JOIN assignment a ON a.id = w.assignment_id
            WHERE w.status IN ('OPEN', 'RETURNED') AND w.next_penalty_at <= :now
              AND w.deducted < a.penalty_limit
            ORDER BY w.next_penalty_at, w.assignment_id, w.student_id LIMIT 1 FOR UPDATE OF w SKIP LOCKED
            """).param("now", AssignmentService.timestamp(now))
            .query((row, index) -> new Due(row.getLong(1), row.getLong(2), row.getInt(3), row.getInt(4),
                row.getObject(5, OffsetDateTime.class).toInstant())).optional();
        if (due.isEmpty()) {
            return false;
        }
        charge(due.get(), now, policy);
        return true;
    }

    // The submission transaction already holds the work lock before settling its last unpaid intervals.
    void settleBeforeSubmission(long assignment, long student, Instant now) {
        db.sql("""
            SELECT w.assignment_id, w.student_id, w.deducted, a.penalty_limit, w.next_penalty_at
            FROM student_work w JOIN assignment a ON a.id = w.assignment_id
            WHERE w.assignment_id = :assignment AND w.student_id = :student
              AND w.status IN ('OPEN', 'RETURNED') AND w.next_penalty_at <= :now
              AND w.deducted < a.penalty_limit
            FOR UPDATE OF w
            """).param("assignment", assignment).param("student", student)
            .param("now", AssignmentService.timestamp(now))
            .query((row, index) -> new Due(row.getLong(1), row.getLong(2), row.getInt(3), row.getInt(4),
                row.getObject(5, OffsetDateTime.class).toInstant())).optional()
            .ifPresent(work -> charge(work, now, settings.current()));
    }

    private void charge(Due work, Instant now, CampusSettings.Values policy) {
        int rating = db.sql("SELECT rating FROM campus_user WHERE id = :student FOR UPDATE")
            .param("student", work.student()).query(Integer.class).single();
        Charge charge = scheduledCharge(policy.penaltyAmount(), rating, work.limit(), work.deducted(), work.nextPenaltyAt(), now,
            policy.penaltyInterval());
        int delta = charge.amount();

        // Advance the schedule even at zero rating, so those intervals do not become debt.
        db.sql("""
            UPDATE student_work SET deducted = deducted + :delta, next_penalty_at = :next
            WHERE assignment_id = :id AND student_id = :student
            """).param("delta", delta).param("next", AssignmentService.timestamp(charge.nextPenaltyAt()))
            .param("id", work.assignment()).param("student", work.student()).update();

        if (delta > 0) {
            db.sql("UPDATE campus_user SET rating = rating - :delta WHERE id = :student")
                .param("delta", delta).param("student", work.student()).update();
            db.sql("""
                INSERT INTO rating_entry(assignment_id, student_id, amount, recorded_at)
                VALUES (:id, :student, :amount, :now)
                """).param("id", work.assignment()).param("student", work.student())
                .param("amount", -delta).param("now", AssignmentService.timestamp(now)).update();
        }
    }

    static Charge scheduledCharge(int step, int rating, int limit, int deducted,
                                  Instant nextPenaltyAt, Instant now, Duration interval) {
        if (now.isBefore(nextPenaltyAt)) return new Charge(0, nextPenaltyAt);

        long intervalsDue = Duration.between(nextPenaltyAt, now).dividedBy(interval) + 1;
        int available = Math.max(0, Math.min(rating, limit - deducted));
        int amount = intervalsDue > available / step ? available : (int) intervalsDue * step;
        return new Charge(amount, nextPenaltyAt.plus(interval.multipliedBy(intervalsDue)));
    }
}

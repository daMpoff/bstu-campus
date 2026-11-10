package ru.bstu.campus;

import java.time.Clock;
import java.time.Duration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Component
class RatingScheduler {
    private final JdbcClient db;
    private final TransactionTemplate transaction;
    private final Clock clock;
    private final Duration interval;
    private final int amount;

    RatingScheduler(JdbcClient db, TransactionTemplate transaction, Clock clock,
                    @Value("${campus.penalty.interval}") Duration interval, @Value("${campus.penalty.amount}") int amount) {
        if (interval.isNegative() || interval.isZero() || amount <= 0) {
            throw new IllegalArgumentException("Настройки списания должны быть положительными.");
        }
        this.db = db;
        this.transaction = transaction;
        this.clock = clock;
        this.interval = interval;
        this.amount = amount;
    }

    private record Due(long assignment, long student, int deducted, int limit) {}

    @Scheduled(fixedDelayString = "${campus.penalty.poll-delay:2s}")
    void applyDuePenalties() {
        for (int processed = 0; processed < 500; processed++) {
            if (!Boolean.TRUE.equals(transaction.execute(status -> chargeNext()))) {
                return;
            }
        }
    }

    private boolean chargeNext() {
        var now = clock.instant();
        var due = db.sql("""
            SELECT w.assignment_id, w.student_id, w.deducted, a.penalty_limit
            FROM student_work w JOIN assignment a ON a.id = w.assignment_id
            JOIN campus_user u ON u.id = w.student_id
            WHERE w.status IN ('OPEN', 'RETURNED') AND w.next_penalty_at <= :now
              AND w.deducted < a.penalty_limit AND u.rating > 0
            ORDER BY w.next_penalty_at, w.assignment_id, w.student_id LIMIT 1 FOR UPDATE OF w SKIP LOCKED
            """).param("now", AssignmentService.timestamp(now))
            .query((row, index) -> new Due(row.getLong(1), row.getLong(2), row.getInt(3), row.getInt(4))).optional();
        if (due.isEmpty()) {
            return false;
        }
        Due work = due.get();
        int rating = db.sql("SELECT rating FROM campus_user WHERE id = :student FOR UPDATE")
            .param("student", work.student()).query(Integer.class).single();
        int delta = deduction(amount, rating, work.limit(), work.deducted());

        db.sql("""
            UPDATE student_work SET deducted = deducted + :delta, next_penalty_at = :next
            WHERE assignment_id = :id AND student_id = :student
            """).param("delta", delta).param("next", AssignmentService.timestamp(now.plus(interval)))
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
        return true;
    }

    static int deduction(int step, int rating, int limit, int deducted) {
        return Math.max(0, Math.min(step, Math.min(rating, limit - deducted)));
    }
}

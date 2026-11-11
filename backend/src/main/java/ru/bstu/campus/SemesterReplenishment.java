package ru.bstu.campus;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.MonthDay;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Component
class SemesterReplenishment {
    private static final int MAX_RATING = 1000;
    private static final ZoneId MOSCOW = ZoneId.of("Europe/Moscow");

    private final JdbcClient db;
    private final TransactionTemplate transaction;
    private final Clock clock;
    private final int amount;
    private final List<MonthDay> startDays;

    SemesterReplenishment(JdbcClient db, TransactionTemplate transaction, Clock clock,
                         @Value("${campus.semester.amount}") int amount,
                         @Value("${campus.semester.start-days}") String startDays) {
        if (amount < 0) {
            throw new IllegalArgumentException("Размер семестрового пополнения АР не может быть отрицательным.");
        }
        this.db = db;
        this.transaction = transaction;
        this.clock = clock;
        this.amount = amount;
        this.startDays = parseStartDays(startDays);
    }

    record Term(int year, boolean autumn) {
        static Term of(LocalDate date) {
            return new Term(date.getYear(), date.getMonthValue() > 6);
        }
    }

    @Scheduled(fixedDelayString = "${campus.semester.check-interval:1m}")
    void replenishDueSemesters() {
        if (amount == 0) return;

        LocalDate earliest = db.sql("""
            SELECT min(semester_credit_from) FROM campus_user WHERE role = 'STUDENT'
            """).query(LocalDate.class).optional().orElse(null);
        if (earliest == null) return;

        Instant now = clock.instant();
        Set<Term> applied = db.sql("SELECT semester_start FROM semester_replenishment_run")
            .query(LocalDate.class).list().stream().map(Term::of).collect(Collectors.toSet());
        for (LocalDate start : dueDates(startDays, earliest, now, applied)) {
            transaction.executeWithoutResult(status -> replenish(start, now));
        }
    }

    private void replenish(LocalDate start, Instant now) {
        var recordedAt = AssignmentService.timestamp(now);
        int inserted = db.sql("""
            INSERT INTO semester_replenishment_run (semester_start, amount, applied_at)
            VALUES (:start, :amount, :now)
            ON CONFLICT DO NOTHING
            """).param("start", start).param("amount", amount).param("now", recordedAt).update();
        if (inserted == 0) return;

        db.sql("""
            WITH eligible AS (
                SELECT id, LEAST(:amount, :maxRating - rating) AS credit
                FROM campus_user
                WHERE role = 'STUDENT' AND semester_credit_from <= :start AND rating < :maxRating
                ORDER BY id FOR UPDATE
            ), credited AS (
                UPDATE campus_user u SET rating = u.rating + e.credit
                FROM eligible e WHERE u.id = e.id
                RETURNING u.id, e.credit
            )
            INSERT INTO rating_entry (student_id, amount, recorded_at, semester_start)
            SELECT id, credit, :now, :start FROM credited
            """).param("amount", amount).param("maxRating", MAX_RATING)
            .param("start", start).param("now", recordedAt).update();
    }

    static List<MonthDay> parseStartDays(String value) {
        List<MonthDay> days;
        try {
            days = Arrays.stream(value.split(",", -1)).map(String::strip)
                .map(day -> MonthDay.parse("--" + day)).sorted().toList();
        } catch (DateTimeParseException failure) {
            throw new IllegalArgumentException("Даты начала семестров задаются в формате ММ-ДД через запятую.", failure);
        }
        if (days.size() != 2 || days.getFirst().getMonthValue() > 6 || days.getLast().getMonthValue() <= 6
                || days.stream().anyMatch(day -> !day.isValidYear(2001))) {
            throw new IllegalArgumentException("Укажите по одной ежегодной дате в первом и втором полугодии.");
        }
        return days;
    }

    static List<LocalDate> dueDates(List<MonthDay> days, LocalDate earliest, Instant now, Set<Term> applied) {
        LocalDate today = now.atZone(MOSCOW).toLocalDate();
        return IntStream.rangeClosed(earliest.getYear(), today.getYear()).boxed()
            .flatMap(year -> days.stream().map(day -> day.atYear(year)))
            .filter(date -> !date.isBefore(earliest) && !date.isAfter(today) && !applied.contains(Term.of(date)))
            .toList();
    }
}

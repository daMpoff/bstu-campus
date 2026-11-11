package ru.bstu.campus;

import java.time.Duration;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
class CampusSettings {
    record Values(int penaltyAmount, int penaltyIntervalSeconds, int semesterAmount,
                  String semesterStartDays, int activityMonthlyLimit) {
        Duration penaltyInterval() {
            return Duration.ofSeconds(penaltyIntervalSeconds);
        }
    }

    record Update(Integer penaltyAmount, Integer penaltyIntervalSeconds, Integer semesterAmount,
                  String semesterStartDays, Integer activityMonthlyLimit) {}

    private final JdbcClient db;
    private final Values defaults;

    CampusSettings(JdbcClient db, @Value("${campus.penalty.amount}") int penaltyAmount,
                   @Value("${campus.penalty.interval}") Duration penaltyInterval,
                   @Value("${campus.semester.amount}") int semesterAmount,
                   @Value("${campus.semester.start-days}") String semesterStartDays,
                   @Value("${campus.activities.monthly-limit}") int activityMonthlyLimit) {
        this.db = db;
        defaults = validate(new Update(penaltyAmount, Math.toIntExact(penaltyInterval.toSeconds()), semesterAmount,
            semesterStartDays, activityMonthlyLimit));
    }

    Values current() {
        return db.sql("""
            SELECT penalty_amount, penalty_interval_seconds, semester_amount, semester_start_days, activity_monthly_limit
            FROM campus_settings WHERE singleton
            """).query(Values.class).optional().orElse(defaults);
    }

    Values save(Update input) {
        Values values = validate(input);
        db.sql("""
            INSERT INTO campus_settings (penalty_amount, penalty_interval_seconds, semester_amount,
                                         semester_start_days, activity_monthly_limit)
            VALUES (:penalty, :interval, :semester, :days, :budget)
            ON CONFLICT (singleton) DO UPDATE SET penalty_amount = excluded.penalty_amount,
                penalty_interval_seconds = excluded.penalty_interval_seconds, semester_amount = excluded.semester_amount,
                semester_start_days = excluded.semester_start_days, activity_monthly_limit = excluded.activity_monthly_limit
            """).param("penalty", values.penaltyAmount()).param("interval", values.penaltyIntervalSeconds())
            .param("semester", values.semesterAmount()).param("days", values.semesterStartDays())
            .param("budget", values.activityMonthlyLimit()).update();
        return values;
    }

    static Values validate(Update input) {
        int penalty = bounded(input.penaltyAmount(), 1, 1000, "Укажите списание от 1 до 1000 АР.");
        int interval = bounded(input.penaltyIntervalSeconds(), 1, 86400, "Укажите интервал от 1 до 86400 секунд.");
        int semester = bounded(input.semesterAmount(), 0, 1000, "Укажите пополнение от 0 до 1000 АР.");
        int budget = bounded(input.activityMonthlyLimit(), 0, Integer.MAX_VALUE, "Укажите неотрицательный бюджет.");
        if (input.semesterStartDays() == null) {
            throw invalid("Укажите даты начала семестров.");
        }
        String days;
        try {
            days = SemesterReplenishment.parseStartDays(input.semesterStartDays()).stream()
                .map(day -> day.toString().substring(2)).collect(Collectors.joining(","));
        } catch (IllegalArgumentException invalidDate) {
            throw invalid(invalidDate.getMessage());
        }
        return new Values(penalty, interval, semester, days, budget);
    }

    private static int bounded(Integer value, int minimum, int maximum, String message) {
        if (value == null || value < minimum || value > maximum) throw invalid(message);
        return value;
    }

    private static ResponseStatusException invalid(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}

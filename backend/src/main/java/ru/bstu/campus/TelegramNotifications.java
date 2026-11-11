package ru.bstu.campus;

import static ru.bstu.campus.AssignmentService.timestamp;

import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
class TelegramNotifications {
    private static final Logger log = LoggerFactory.getLogger(TelegramNotifications.class);
    private static final DateTimeFormatter DEADLINE_FORMAT = DateTimeFormatter.ofPattern("d MMMM 'в' HH:mm 'МСК'",
        Locale.forLanguageTag("ru")).withZone(ZoneId.of("Europe/Moscow"));
    private final JdbcClient db;
    private final TelegramBotApi bot;
    private final TransactionTemplate transactions;
    private final Clock clock;
    private final URI publicUrl;
    private Instant retryAt = Instant.MIN;

    TelegramNotifications(JdbcClient db, TelegramBotApi bot, TransactionTemplate transactions, Clock clock,
                          @Value("${campus.public-url}") URI publicUrl) {
        this.db = db;
        this.bot = bot;
        this.transactions = transactions;
        this.clock = clock;
        this.publicUrl = publicUrl;
    }

    private record Pending(long id, long bindingId, long chatId, String title, String details, String linkPath,
                           OffsetDateTime deadline, boolean obsolete, int attempts) {}
    private enum Outcome { DELIVERED, EMPTY, RETRY, BLOCKED }
    private record Delivery(Outcome outcome, Long blockedBinding) {}

    @Scheduled(fixedDelayString = "${campus.telegram.delivery-delay:4s}")
    void deliver() {
        if (!bot.configured() || clock.instant().isBefore(retryAt)) return;
        var now = timestamp(clock.instant());
        db.sql("DELETE FROM telegram_pairing_code WHERE expires_at <= :now").param("now", now).update();
        db.sql("DELETE FROM telegram_delivery WHERE expires_at <= :now").param("now", now).update();
        enqueueFeedEvents(now);
        enqueueDeadlines(now);
        for (int batch = 0; batch < 20; batch++) {
            Delivery result = transactions.execute(status -> deliverOne());
            if (result.outcome() == Outcome.EMPTY || result.outcome() == Outcome.RETRY) break;
            if (result.outcome() == Outcome.BLOCKED) {
                db.sql("DELETE FROM telegram_chat WHERE id = :binding").param("binding", result.blockedBinding()).update();
            }
        }
    }

    private void enqueueFeedEvents(OffsetDateTime now) {
        db.sql("""
            INSERT INTO telegram_delivery (binding_id, event_id, available_at, expires_at)
            SELECT b.id, e.id, :now, e.occurred_at + INTERVAL '3 days'
            FROM telegram_chat b
            JOIN campus_user u ON u.id = b.user_id
            JOIN personal_feed_event e ON e.recipient_id = b.user_id AND e.occurred_at >= b.linked_at
            WHERE b.bot_id = :bot AND u.email_verified AND (u.role <> 'STUDENT' OR u.group_verified)
              AND e.occurred_at > :now - INTERVAL '3 days'
              AND e.event_type <> 'ASSIGNMENT_DUE'
              AND NOT EXISTS (SELECT 1 FROM telegram_delivery d WHERE d.binding_id = b.id AND d.event_id = e.id)
            ORDER BY e.id LIMIT 200
            ON CONFLICT DO NOTHING
            """).param("bot", bot.botId()).param("now", now).update();
    }

    private void enqueueDeadlines(OffsetDateTime now) {
        db.sql("""
            INSERT INTO telegram_delivery (binding_id, assignment_id, reminder_hours, available_at, expires_at)
            SELECT b.id, a.id, reminder.hours, :now, a.deadline
            FROM telegram_chat b
            JOIN campus_user u ON u.id = b.user_id
            JOIN student_work w ON w.student_id = b.user_id AND w.status IN ('OPEN', 'RETURNED')
            JOIN assignment a ON a.id = w.assignment_id
            CROSS JOIN LATERAL (SELECT CASE WHEN a.deadline <= :now + INTERVAL '2 hours' THEN 2 ELSE 24 END AS hours) reminder
            WHERE b.bot_id = :bot AND u.email_verified AND u.group_verified
              AND a.deadline > :now AND a.deadline <= :now + INTERVAL '24 hours'
              AND NOT EXISTS (SELECT 1 FROM telegram_delivery d WHERE d.binding_id = b.id
                  AND d.assignment_id = a.id AND d.reminder_hours = reminder.hours)
            ORDER BY a.deadline, b.id LIMIT 200
            ON CONFLICT DO NOTHING
            """).param("bot", bot.botId()).param("now", now).update();
    }

    private Delivery deliverOne() {
        Instant now = clock.instant();
        var next = db.sql("""
            SELECT d.id, b.id AS binding_id, b.chat_id,
                   COALESCE(e.title, 'Скоро дедлайн') AS title,
                   COALESCE(e.details, a.title) AS details,
                   CASE WHEN e.event_type = 'ACTIVITY_CREATED' THEN '/activities#activity-' || e.entity_id
                        ELSE COALESCE(e.link_path, '/assignments/' || d.assignment_id) END AS link_path,
                   a.deadline, d.attempts,
                   NOT u.email_verified OR (u.role = 'STUDENT' AND NOT u.group_verified)
                   OR (d.reminder_hours IS NOT NULL AND (
                       w.status IS NULL OR w.status NOT IN ('OPEN', 'RETURNED')
                       OR (d.reminder_hours = 24 AND a.deadline <= :now + INTERVAL '2 hours')
                   )) AS obsolete
            FROM telegram_delivery d
            JOIN telegram_chat b ON b.id = d.binding_id
            JOIN campus_user u ON u.id = b.user_id
            LEFT JOIN personal_feed_event e ON e.id = d.event_id
            LEFT JOIN assignment a ON a.id = COALESCE(d.assignment_id,
                CASE WHEN e.event_type IN ('ASSIGNMENT_CREATED', 'WORK_RETURNED') THEN e.entity_id END)
            LEFT JOIN student_work w ON w.assignment_id = d.assignment_id AND w.student_id = b.user_id
            WHERE b.bot_id = :bot AND d.completed_at IS NULL AND d.available_at <= :now AND d.expires_at > :now
            ORDER BY d.available_at, d.id LIMIT 1 FOR UPDATE OF d SKIP LOCKED
            """).param("bot", bot.botId()).param("now", timestamp(now)).query(Pending.class).optional();
        if (next.isEmpty()) return new Delivery(Outcome.EMPTY, null);

        Pending row = next.get();
        if (row.obsolete()) {
            complete(row.id());
            return new Delivery(Outcome.DELIVERED, null);
        }
        try {
            bot.send(row.chatId(), message(row, now));
            complete(row.id());
            return new Delivery(Outcome.DELIVERED, null);
        } catch (TelegramBotApi.Failure failure) {
            return failed(row, failure, now);
        }
    }

    private Delivery failed(Pending row, TelegramBotApi.Failure failure, Instant now) {
        if (failure.status() == 403) {
            complete(row.id());
            return new Delivery(Outcome.BLOCKED, row.bindingId());
        }
        if (failure.status() == 400) {
            complete(row.id());
            log.warn("Telegram отклонил уведомление {}.", row.id());
            return new Delivery(Outcome.DELIVERED, null);
        }
        long delay = Math.max(30L << Math.min(row.attempts(), 6), failure.retryAfter());
        db.sql("UPDATE telegram_delivery SET attempts = attempts + 1, available_at = :retry WHERE id = :id")
            .param("id", row.id()).param("retry", timestamp(now.plusSeconds(delay))).update();
        retryAt = now.plusSeconds(Math.max(15, failure.retryAfter()));
        log.warn("Уведомление {} не доставлено в Telegram. Код: {}. Повтор через {} секунд.",
            row.id(), failure.status(), delay);
        return new Delivery(Outcome.RETRY, null);
    }

    private void complete(long id) {
        db.sql("UPDATE telegram_delivery SET completed_at = :now WHERE id = :id")
            .param("id", id).param("now", timestamp(clock.instant())).update();
    }

    private String message(Pending row, Instant now) {
        StringBuilder message = new StringBuilder(row.title()).append('\n').append(row.details());
        if (row.deadline() != null) {
            Instant deadline = row.deadline().toInstant();
            message.append("\nСрок сдачи: ").append(DEADLINE_FORMAT.format(deadline));
            if (deadline.isAfter(now)) message.append("\nОсталось: ").append(remaining(Duration.between(now, deadline)));
        }
        return message.append("\n\n").append(publicUrl.resolve(row.linkPath())).toString();
    }

    static String remaining(Duration duration) {
        long minutes = duration.toMinutes();
        if (minutes == 0) return "меньше минуты";
        if (minutes < 60) return minutes + " мин";
        if (minutes < 24 * 60) {
            return minutes / 60 + " ч" + (minutes % 60 == 0 ? "" : " " + minutes % 60 + " мин");
        }
        long hours = minutes / 60;
        return hours / 24 + " д" + (hours % 24 == 0 ? "" : " " + hours % 24 + " ч");
    }
}

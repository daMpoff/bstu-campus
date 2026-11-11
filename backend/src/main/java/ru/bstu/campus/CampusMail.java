package ru.bstu.campus;

import java.net.URI;
import java.time.Clock;
import java.time.Instant;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.MailException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
class CampusMail {
    private static final Logger log = LoggerFactory.getLogger(CampusMail.class);
    private final JdbcClient db;
    private final TransactionTemplate transactions;
    private final JavaMailSender sender;
    private final Clock clock;
    private final String from;
    private final URI publicUrl;

    CampusMail(JdbcClient db, TransactionTemplate transactions, JavaMailSender sender, Clock clock,
               @Value("${campus.mail.from}") String from, @Value("${campus.public-url}") URI publicUrl) {
        if (publicUrl.getHost() == null || !java.util.Set.of("http", "https").contains(publicUrl.getScheme())) {
            throw new IllegalArgumentException("Укажите HTTP(S) адрес кампуса в CAMPUS_PUBLIC_URL.");
        }
        this.db = db;
        this.transactions = transactions;
        this.sender = sender;
        this.clock = clock;
        this.from = from;
        this.publicUrl = publicUrl;
    }

    void confirmation(String email, String token, Instant expiresAt) {
        String link = publicUrl.resolve("/confirm-email#" + token).toString();
        db.sql("""
            INSERT INTO campus_mail (recipient, subject, body, available_at, expires_at)
            VALUES (:email, 'Подтвердите email в БГТУ', :body, :now, :expires)
            """).param("email", email).param("body", "Подтвердите email по ссылке:\n" + link
                + "\n\nСсылка действует 24 часа. Если вы не регистрировались, письмо можно проигнорировать.")
            .param("now", AssignmentService.timestamp(clock.instant()))
            .param("expires", AssignmentService.timestamp(expiresAt)).update();
    }

    @Scheduled(fixedDelayString = "${campus.mail.poll-delay:3s}")
    void deliver() {
        var now = AssignmentService.timestamp(clock.instant());
        db.sql("UPDATE campus_mail SET body = NULL WHERE body IS NOT NULL AND expires_at <= :now")
            .param("now", now).update();
        enqueueNotifications();
        for (int delivered = 0; delivered < 20; delivered++) {
            if (!Boolean.TRUE.equals(transactions.execute(status -> deliverOne()))) break;
        }
    }

    private void enqueueNotifications() {
        db.sql("""
            INSERT INTO campus_mail (event_id, recipient, subject, body, available_at, expires_at)
            SELECT e.id, u.email,
                   CASE e.event_type WHEN 'ASSIGNMENT_DUE' THEN 'Скоро дедлайн'
                     WHEN 'WORK_ACCEPTED' THEN 'Работа принята'
                     WHEN 'ACTIVITY_AWARDED' THEN 'Начислены баллы активности'
                     ELSE 'Новая активность' END || ' · БГТУ',
                   e.title || E'\\n' || e.details || E'\\n\\n' || :site || e.link_path,
                   :now, due.deadline
            FROM personal_feed_event e JOIN campus_user u ON u.id = e.recipient_id
            LEFT JOIN assignment due ON e.event_type = 'ASSIGNMENT_DUE' AND due.id = e.entity_id
            LEFT JOIN student_work pending ON pending.assignment_id = due.id AND pending.student_id = e.recipient_id
            WHERE u.email_verified AND e.notify_email
              AND e.event_type IN ('ASSIGNMENT_DUE', 'WORK_ACCEPTED', 'ACTIVITY_AWARDED', 'ACTIVITY_CREATED')
              AND (e.event_type <> 'ASSIGNMENT_DUE' OR (due.deadline > :now AND pending.status IN ('OPEN', 'RETURNED')))
              AND NOT EXISTS (SELECT 1 FROM campus_mail m WHERE m.event_id = e.id)
            ORDER BY e.id LIMIT 200
            ON CONFLICT (event_id) DO NOTHING
            """).param("site", publicUrl.resolve("/").toString().replaceFirst("/$", ""))
            .param("now", AssignmentService.timestamp(clock.instant())).update();
    }

    private record Pending(long id, String recipient, String subject, String body, int attempts) {}

    private boolean deliverOne() {
        Instant now = clock.instant();
        var pending = db.sql("""
            SELECT id, recipient, subject, body, attempts FROM campus_mail
            WHERE body IS NOT NULL AND available_at <= :now AND (expires_at IS NULL OR expires_at > :now)
            ORDER BY available_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
            """).param("now", AssignmentService.timestamp(now)).query(Pending.class).optional();
        if (pending.isEmpty()) return false;

        Pending row = pending.get();
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(from);
        message.setTo(row.recipient());
        message.setSubject(row.subject());
        message.setText(row.body());
        try {
            sender.send(message);
        } catch (MailException failure) {
            long delay = 30L << Math.min(row.attempts(), 7);
            db.sql("UPDATE campus_mail SET attempts = attempts + 1, available_at = :retry WHERE id = :id")
                .param("id", row.id()).param("retry", AssignmentService.timestamp(now.plusSeconds(delay))).update();
            log.warn("Письмо {} не доставлено. Повтор через {} секунд.", row.id(), delay);
            return false;
        }
        db.sql("UPDATE campus_mail SET body = NULL, sent_at = :now WHERE id = :id")
            .param("id", row.id()).param("now", AssignmentService.timestamp(clock.instant())).update();
        return true;
    }
}

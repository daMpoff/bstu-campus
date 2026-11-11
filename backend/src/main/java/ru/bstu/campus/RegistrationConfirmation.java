package ru.bstu.campus;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
class RegistrationConfirmation {
    private final JdbcClient db;
    private final CampusMail mail;
    private final CampusSettings settings;
    private final Clock clock;
    private final GroupLeadership leadership;
    private final SecureRandom random = new SecureRandom();

    RegistrationConfirmation(JdbcClient db, CampusMail mail, CampusSettings settings, Clock clock,
                             GroupLeadership leadership) {
        this.db = db;
        this.mail = mail;
        this.settings = settings;
        this.clock = clock;
        this.leadership = leadership;
    }

    void issue(long userId, String email) {
        byte[] randomBytes = new byte[32];
        random.nextBytes(randomBytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes);
        Instant now = clock.instant();
        Instant expiry = now.plus(Duration.ofHours(24));
        db.sql("""
            INSERT INTO email_confirmation (user_id, token_hash, expires_at, created_at)
            VALUES (:user, :hash, :expires, :now)
            ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash,
                expires_at = EXCLUDED.expires_at, created_at = EXCLUDED.created_at
            """).param("user", userId).param("hash", hash(token))
            .param("expires", AssignmentService.timestamp(expiry)).param("now", AssignmentService.timestamp(now)).update();
        db.sql("UPDATE campus_mail SET body = NULL WHERE recipient = :email AND event_id IS NULL AND body IS NOT NULL")
            .param("email", email).update();
        mail.confirmation(email, token, expiry);
    }

    @Transactional
    void resend(String input) {
        String email = input == null ? "" : input.strip().toLowerCase(Locale.ROOT);
        db.sql("SELECT id FROM campus_user WHERE email = :email AND NOT email_verified FOR UPDATE")
            .param("email", email).query(Long.class).optional().ifPresent(userId -> {
                boolean recent = db.sql("""
                    SELECT EXISTS (SELECT 1 FROM email_confirmation WHERE user_id = :user AND created_at > :recent)
                    """).param("user", userId).param("recent", AssignmentService.timestamp(clock.instant().minusSeconds(60)))
                    .query(Boolean.class).single();
                if (!recent) issue(userId, email);
            });
    }

    @Transactional
    void confirmEmail(String token) {
        if (token == null || !token.matches("[A-Za-z0-9_-]{43}")) throw invalidLink();
        String tokenHash = hash(token);
        ConfirmationTarget target = db.sql("""
            SELECT u.id, u.group_id, u.group_verified FROM email_confirmation c JOIN campus_user u ON u.id = c.user_id
            WHERE c.token_hash = :hash AND c.expires_at > :now
            """).param("hash", tokenHash).param("now", AssignmentService.timestamp(clock.instant())).query(ConfirmationTarget.class)
            .optional().orElseThrow(RegistrationConfirmation::invalidLink);
        long userId = target.id();
        if (target.groupId() != null) leadership.lockGroup(target.groupId());
        db.sql("SELECT id FROM campus_user WHERE id = :user FOR UPDATE").param("user", userId).query(Long.class).single();
        int used = db.sql("DELETE FROM email_confirmation WHERE user_id = :user AND token_hash = :hash AND expires_at > :now")
            .param("user", userId).param("hash", tokenHash).param("now", AssignmentService.timestamp(clock.instant())).update();
        if (used == 0) throw invalidLink();
        db.sql("UPDATE campus_user SET email_verified = true WHERE id = :user").param("user", userId).update();
        if (target.groupId() != null && target.groupVerified()) assignOpenWork(userId, target.groupId());
    }

    private record ConfirmationTarget(long id, Long groupId, boolean groupVerified) {}

    @Transactional
    void approveGroup(AssignmentService.Account approver, long groupId, long studentId) {
        leadership.lockGroup(groupId);
        leadership.requireApproval(approver, groupId);
        var now = AssignmentService.timestamp(clock.instant());
        int approved = db.sql("""
            UPDATE campus_user SET group_verified = true, group_verified_by = :approver, group_verified_at = :now
            WHERE id = :student AND role = 'STUDENT' AND group_id = :group AND email_verified AND NOT group_verified
            """).param("student", studentId).param("group", groupId).param("approver", approver.id()).param("now", now).update();
        if (approved == 0) throw missingStudent();
        assignOpenWork(studentId, groupId);
    }

    private void assignOpenWork(long studentId, long groupId) {
        db.sql("""
            INSERT INTO student_work (assignment_id, student_id, next_penalty_at)
            SELECT a.id, :student, a.deadline + CAST(:interval AS interval)
            FROM assignment a JOIN assignment_group g ON g.assignment_id = a.id
            WHERE g.group_id = :group AND a.deadline > :now AND NOT a.individual
            ON CONFLICT DO NOTHING
            """).param("student", studentId).param("group", groupId).param("now", AssignmentService.timestamp(clock.instant()))
            .param("interval", settings.current().penaltyIntervalSeconds() + " seconds").update();
    }

    private static ResponseStatusException invalidLink() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "Ссылка недействительна. Запросите новое письмо.");
    }

    private static ResponseStatusException missingStudent() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "В этой группе нет такого студента, ожидающего подтверждения.");
    }

    private static String hash(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }
}

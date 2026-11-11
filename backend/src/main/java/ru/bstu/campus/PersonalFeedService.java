package ru.bstu.campus;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
class PersonalFeedService {
    private static final int PAGE_SIZE = 30;
    private final JdbcClient db;
    private final Clock clock;

    PersonalFeedService(JdbcClient db, Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    record Event(long id, String eventType, Instant occurredAt, String title, String details, String linkPath) {}
    record Page(List<Event> entries, Long nextBeforeId) {}

    Page page(long recipient, Long beforeId) {
        String cursor = beforeId == null ? "" : """
            AND (occurred_at, id) < (
                SELECT occurred_at, id FROM personal_feed_event WHERE id = :before AND recipient_id = :recipient
            )
            """;
        var query = db.sql("""
            SELECT id, event_type, occurred_at, title, details, link_path
            FROM personal_feed_event WHERE recipient_id = :recipient
            """ + cursor + " ORDER BY occurred_at DESC, id DESC LIMIT :limit")
            .param("recipient", recipient).param("limit", PAGE_SIZE + 1);
        if (beforeId != null) query.param("before", beforeId);
        List<Event> events = query.query((row, index) -> new Event(row.getLong("id"), row.getString("event_type"),
            row.getObject("occurred_at", OffsetDateTime.class).toInstant(), row.getString("title"),
            row.getString("details"), row.getString("link_path"))).list();
        if (events.size() <= PAGE_SIZE) return new Page(events, null);
        return new Page(events.subList(0, PAGE_SIZE), events.get(PAGE_SIZE - 1).id());
    }

    @Scheduled(fixedDelayString = "${campus.feed.refresh-interval:5s}")
    void recordTimedEvents() {
        var now = AssignmentService.timestamp(clock.instant());
        db.sql("""
            INSERT INTO personal_feed_event (recipient_id, event_type, entity_id, occurred_at, title, details, link_path)
            SELECT w.student_id, 'ASSIGNMENT_DUE', a.id, :now, 'До дедлайна меньше суток', a.title, '/assignments/' || a.id
            FROM student_work w JOIN assignment a ON a.id = w.assignment_id JOIN campus_user u ON u.id = w.student_id
            WHERE w.status IN ('OPEN', 'RETURNED') AND u.email_verified AND u.group_verified
                AND a.deadline > :now AND a.deadline < :now + INTERVAL '24 hours'
                AND NOT EXISTS (SELECT 1 FROM personal_feed_event e WHERE e.recipient_id = w.student_id
                    AND e.entity_id = a.id AND e.event_type = 'ASSIGNMENT_DUE')
            ON CONFLICT DO NOTHING
            """).param("now", now).update();
        db.sql("""
            INSERT INTO personal_feed_event (recipient_id, event_type, entity_id, occurred_at, title, details, link_path)
            SELECT p.teacher_id, 'POLL_ENDED', p.id, p.ends_at, 'Опрос завершён', p.title, '/polls/' || p.id
            FROM poll p WHERE p.ends_at <= :now
                AND NOT EXISTS (SELECT 1 FROM personal_feed_event e WHERE e.recipient_id = p.teacher_id
                    AND e.entity_id = p.id AND e.event_type = 'POLL_ENDED')
            ON CONFLICT DO NOTHING
            """).param("now", now).update();
    }
}

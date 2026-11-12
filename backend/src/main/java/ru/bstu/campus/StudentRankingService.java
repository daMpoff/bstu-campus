package ru.bstu.campus;

import java.math.BigDecimal;
import java.sql.Types;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.stream.Collectors;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
class StudentRankingService {
    private static final int PAGE_SIZE = 25;
    private final JdbcClient db;
    private final AssignmentService accounts;

    StudentRankingService(JdbcClient db, AssignmentService accounts) {
        this.db = db;
        this.accounts = accounts;
    }

    enum Metric {
        AR(null), BUA("ACADEMIC"), BOA("PUBLIC");

        private final String activityKind;

        Metric(String activityKind) {
            this.activityKind = activityKind;
        }
    }

    record Group(long id, String name, Long facultyId) {}
    record Catalog(List<AssignmentService.Group> faculties, List<Group> groups) {}
    record Entry(long studentId, String fullName, String groupName, Long place, BigDecimal points) {}
    record Leader(Entry student, long tiedStudents, List<Entry> displayStudents) {}
    record Ranking(List<Leader> leaders, List<Entry> entries, Entry viewer, int page, int pageSize, long total) {}
    private record RankedRow(Entry entry, long peers, boolean topPlaceMember, boolean onPage, int page, long total) {}

    Catalog catalog() {
        var faculties = db.sql("SELECT id, name FROM faculty ORDER BY name").query(AssignmentService.Group.class).list();
        var groups = db.sql("SELECT id, name, faculty_id FROM study_group ORDER BY name").query(Group.class).list();
        return new Catalog(faculties, groups);
    }

    Ranking ranking(String email, Metric metric, Long facultyId, Long groupId, int requestedPage) {
        if (requestedPage < 1) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Номер страницы должен быть положительным.");
        }
        long viewerId = accounts.account(email).id();
        var rows = db.sql("""
            WITH scores AS (
                SELECT u.id, u.full_name, g.name AS group_name,
                       CASE WHEN :kind IS NULL THEN u.rating::numeric ELSE (
                           SELECT COALESCE(sum(award.points), 0)
                           FROM activity_award award JOIN activity a ON a.id = award.activity_id
                           WHERE award.student_id = u.id AND a.kind = :kind
                       ) END AS points
                FROM campus_user u JOIN study_group g ON g.id = u.group_id
                WHERE u.role = 'STUDENT' AND u.group_verified AND u.email_verified
                  AND (:faculty IS NULL OR COALESCE(g.faculty_id, u.faculty_id) = :faculty)
                  AND (:group IS NULL OR g.id = :group)
            ), ranked AS (
                SELECT *, dense_rank() OVER (ORDER BY points DESC) AS place,
                       row_number() OVER (ORDER BY points DESC, full_name, id) AS position,
                       row_number() OVER (PARTITION BY points ORDER BY full_name, id) AS tie_order,
                       count(*) OVER (PARTITION BY points) AS peers,
                       count(*) OVER () AS total
                FROM scores
            ), paged AS (
                SELECT *, least(:page, (total + :size - 1) / :size) AS page,
                       (place <= 3 AND tie_order <= 2 AND (:kind IS NULL OR points > 0)) AS top_place_member
                FROM ranked
            ), visible AS (
                SELECT *, position > (page - 1) * :size AND position <= page * :size AS on_page
                FROM paged
            )
            SELECT * FROM visible WHERE top_place_member OR on_page OR id = :viewer ORDER BY position
            """).param("kind", metric.activityKind, Types.VARCHAR)
            .param("faculty", facultyId, Types.BIGINT).param("group", groupId, Types.BIGINT)
            .param("page", requestedPage).param("size", PAGE_SIZE).param("viewer", viewerId)
            .query((row, index) -> {
                var points = row.getBigDecimal("points");
                Long place = metric != Metric.AR && points.signum() == 0 ? null : row.getLong("place");
                var entry = new Entry(row.getLong("id"), row.getString("full_name"), row.getString("group_name"), place, points);
                return new RankedRow(entry, row.getLong("peers"), row.getBoolean("top_place_member"), row.getBoolean("on_page"),
                    row.getInt("page"), row.getLong("total"));
            }).list();
        if (rows.isEmpty()) {
            return new Ranking(List.of(), List.of(), null, 1, PAGE_SIZE, 0);
        }
        var topPlaces = rows.stream().filter(RankedRow::topPlaceMember).collect(Collectors.groupingBy(
            row -> row.entry().place(), LinkedHashMap::new, Collectors.toList()));
        var leaders = topPlaces.values().stream().map(members -> {
            var first = members.getFirst();
            return new Leader(first.entry(), first.peers(), members.stream().map(RankedRow::entry).toList());
        }).toList();
        var entries = rows.stream().filter(RankedRow::onPage).map(RankedRow::entry).toList();
        var viewer = rows.stream().map(RankedRow::entry).filter(entry -> entry.studentId() == viewerId).findFirst().orElse(null);
        return new Ranking(leaders, entries, viewer, rows.getFirst().page(), PAGE_SIZE, rows.getFirst().total());
    }
}

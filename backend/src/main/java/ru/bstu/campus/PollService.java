package ru.bstu.campus;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
class PollService {
    private static final String POLL_FIELDS = """
        SELECT p.id, p.title, p.description, p.ends_at, p.anonymous, teacher.full_name AS teacher_name,
            ARRAY(SELECT g.name FROM poll_group pg JOIN study_group g ON g.id = pg.group_id
                  WHERE pg.poll_id = p.id ORDER BY g.name) AS groups,
            (SELECT count(*) FROM poll_question q WHERE q.poll_id = p.id) AS question_count,
            (SELECT count(*) FROM poll_ballot b WHERE b.poll_id = p.id) AS response_count,
            EXISTS(SELECT 1 FROM poll_voter v WHERE v.poll_id = p.id AND v.student_id = :viewer) AS voted
        FROM poll p JOIN campus_user teacher ON teacher.id = p.teacher_id
        """;
    private static final String STUDENT_ACCESS = """
        EXISTS(SELECT 1 FROM poll_group pg JOIN campus_user u ON u.group_id = pg.group_id
            WHERE pg.poll_id = p.id AND u.id = :viewer AND u.role = 'STUDENT'
              AND u.email_verified AND u.group_verified)
        """;

    private final JdbcClient db;
    private final Clock clock;

    PollService(JdbcClient db, Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    enum ChoiceType { SINGLE, MULTIPLE }
    record NewQuestion(String text, ChoiceType choiceType, List<String> options) {}
    record NewPoll(String title, String description, Instant endsAt, boolean anonymous, List<Long> groupIds,
                   List<NewQuestion> questions) {}
    record Answer(Long questionId, List<Long> optionIds) {}
    record Vote(List<Answer> answers) {}
    record Summary(long id, String title, String description, Instant endsAt, boolean anonymous, String teacherName,
                   List<String> groups, int questionCount, Integer responseCount, boolean closed, boolean voted) {}
    record Option(long id, String text) {}
    record Question(long id, String text, ChoiceType choiceType, List<Option> options) {}
    record OptionCount(long optionId, int votes) {}
    record Respondent(long studentId, String studentName, String groupName, List<Long> optionIds) {}
    record Results(List<OptionCount> options, List<Respondent> respondents) {}
    record Detail(Summary poll, List<Question> questions, Results results) {}

    private record QuestionRow(long id, String text, ChoiceType choiceType) {}

    List<Summary> list(long viewer, boolean teacher) {
        Instant now = clock.instant();
        return db.sql(POLL_FIELDS + " WHERE " + access(teacher) + " ORDER BY p.ends_at DESC, p.id DESC")
            .param("viewer", viewer).query((row, index) -> summary(row, teacher, now)).list();
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    Detail detail(long viewer, long id, boolean teacher) {
        Summary poll = poll(viewer, id, teacher);
        Results results = teacher || poll.voted() ? results(poll, teacher) : null;
        return new Detail(poll, questions(id), results);
    }

    @Transactional
    long create(long teacher, NewPoll input) {
        String title = required(input.title(), 160, "Введите название опроса длиной до 160 символов.");
        String description = required(input.description(), 5000, "Введите описание опроса длиной до 5000 символов.");
        Instant now = clock.instant();
        if (input.endsAt() == null || !input.endsAt().isAfter(now)) {
            throw badRequest("Укажите дату и время окончания в будущем.");
        }
        List<Long> groups = input.groupIds() == null ? List.of() : input.groupIds().stream().distinct().toList();
        if (groups.isEmpty() || groups.stream().anyMatch(group -> group == null || group < 1)
                || db.sql("SELECT count(*) FROM study_group WHERE id IN (:groups)")
                    .param("groups", groups).query(Long.class).single() != groups.size()) {
            throw badRequest("Выберите учебные группы из списка.");
        }
        List<NewQuestion> questions = validateQuestions(input.questions());
        long id = db.sql("""
            INSERT INTO poll (teacher_id, title, description, ends_at, anonymous, created_at)
            VALUES (:teacher, :title, :description, :end, :anonymous, :created) RETURNING id
            """).param("teacher", teacher).param("title", title).param("description", description)
            .param("end", AssignmentService.timestamp(input.endsAt())).param("anonymous", input.anonymous())
            .param("created", AssignmentService.timestamp(now)).query(Long.class).single();

        for (int index = 0; index < questions.size(); index++) {
            insertQuestion(id, index, questions.get(index));
        }
        db.sql("INSERT INTO poll_group (poll_id, group_id) SELECT :poll, id FROM study_group WHERE id IN (:groups)")
            .param("poll", id).param("groups", groups).update();
        return id;
    }

    @Transactional
    void vote(long student, long id, Vote input) {
        Summary poll = poll(student, id, false);
        if (poll.closed()) throw conflict("Опрос завершён.");
        if (poll.voted()) throw conflict("Вы уже ответили на этот опрос.");
        List<Long> selections = selections(questions(id), input.answers());
        if (!clock.instant().isBefore(poll.endsAt())) throw conflict("Опрос завершён.");

        int receipt = db.sql("""
            INSERT INTO poll_voter (poll_id, student_id) VALUES (:poll, :student) ON CONFLICT DO NOTHING
            """).param("poll", id).param("student", student).update();
        if (receipt == 0) throw conflict("Вы уже ответили на этот опрос.");

        long ballot = db.sql("INSERT INTO poll_ballot (poll_id, student_id) VALUES (:poll, :student) RETURNING id")
            .param("poll", id).param("student", poll.anonymous() ? null : student, Types.BIGINT).query(Long.class).single();
        db.sql("INSERT INTO poll_selection (ballot_id, option_id) SELECT :ballot, id FROM poll_option WHERE id IN (:options)")
            .param("ballot", ballot).param("options", selections).update();
    }

    private Summary poll(long viewer, long id, boolean teacher) {
        Instant now = clock.instant();
        return db.sql(POLL_FIELDS + " WHERE p.id = :id AND " + access(teacher))
            .param("id", id).param("viewer", viewer).query((row, index) -> summary(row, teacher, now))
            .optional().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Опрос недоступен."));
    }

    private static String access(boolean teacher) {
        return teacher ? "p.teacher_id = :viewer" : STUDENT_ACCESS;
    }

    private static Summary summary(ResultSet row, boolean teacher, Instant now) throws SQLException {
        Instant endsAt = row.getObject("ends_at", OffsetDateTime.class).toInstant();
        boolean voted = row.getBoolean("voted");
        return new Summary(row.getLong("id"), row.getString("title"), row.getString("description"), endsAt,
            row.getBoolean("anonymous"), row.getString("teacher_name"), List.of((String[]) row.getArray("groups").getArray()),
            row.getInt("question_count"), teacher || voted ? row.getInt("response_count") : null, !now.isBefore(endsAt), voted);
    }

    private List<Question> questions(long id) {
        List<QuestionRow> rows = db.sql("SELECT id, text, choice_type FROM poll_question WHERE poll_id = :id ORDER BY position")
            .param("id", id).query((row, index) -> new QuestionRow(row.getLong("id"), row.getString("text"),
                ChoiceType.valueOf(row.getString("choice_type")))).list();
        return rows.stream().map(question -> new Question(question.id(), question.text(), question.choiceType(), db.sql("""
            SELECT id, text FROM poll_option WHERE question_id = :question ORDER BY position
            """).param("question", question.id()).query(Option.class).list())).toList();
    }

    private Results results(Summary poll, boolean teacher) {
        List<OptionCount> counts = db.sql("""
            SELECT o.id, count(s.ballot_id) AS votes
            FROM poll_question q JOIN poll_option o ON o.question_id = q.id
            LEFT JOIN poll_selection s ON s.option_id = o.id
            WHERE q.poll_id = :poll GROUP BY o.id ORDER BY o.id
            """).param("poll", poll.id()).query((row, index) -> new OptionCount(row.getLong("id"), row.getInt("votes"))).list();
        List<Respondent> respondents = null;
        if (teacher && !poll.anonymous()) {
            respondents = db.sql("""
                SELECT u.id, u.full_name, g.name AS group_name,
                    ARRAY(SELECT s.option_id FROM poll_selection s WHERE s.ballot_id = b.id ORDER BY s.option_id) AS options
                FROM poll_ballot b JOIN campus_user u ON u.id = b.student_id
                LEFT JOIN study_group g ON g.id = u.group_id
                WHERE b.poll_id = :poll ORDER BY u.full_name, u.id
                """).param("poll", poll.id()).query((row, index) -> new Respondent(row.getLong("id"), row.getString("full_name"),
                    row.getString("group_name"), List.of((Long[]) row.getArray("options").getArray()))).list();
        }
        return new Results(counts, respondents);
    }

    private void insertQuestion(long poll, int position, NewQuestion question) {
        long id = db.sql("""
            INSERT INTO poll_question (poll_id, position, text, choice_type)
            VALUES (:poll, :position, :text, :type) RETURNING id
            """).param("poll", poll).param("position", position).param("text", question.text())
            .param("type", question.choiceType().name()).query(Long.class).single();
        for (int index = 0; index < question.options().size(); index++) {
            db.sql("INSERT INTO poll_option (question_id, position, text) VALUES (:question, :position, :text)")
                .param("question", id).param("position", index).param("text", question.options().get(index)).update();
        }
    }

    private static List<NewQuestion> validateQuestions(List<NewQuestion> questions) {
        if (questions == null || questions.isEmpty() || questions.size() > 10) {
            throw badRequest("В опросе должно быть от 1 до 10 вопросов.");
        }
        return questions.stream().map(question -> {
            if (question == null || question.choiceType() == null || question.options() == null
                    || question.options().size() < 2 || question.options().size() > 12) {
                throw badRequest("Для каждого вопроса выберите тип ответа и укажите от 2 до 12 вариантов.");
            }
            String text = required(question.text(), 300, "Введите вопрос длиной до 300 символов.");
            List<String> options = question.options().stream()
                .map(option -> required(option, 200, "Введите вариант ответа длиной до 200 символов.")).toList();
            if (options.stream().map(option -> option.toLowerCase(Locale.ROOT)).distinct().count() != options.size()) {
                throw badRequest("Варианты ответа на один вопрос должны различаться.");
            }
            return new NewQuestion(text, question.choiceType(), options);
        }).toList();
    }

    private static List<Long> selections(List<Question> questions, List<Answer> answers) {
        if (answers == null || answers.size() != questions.size()) {
            throw badRequest("Ответьте на все вопросы.");
        }
        Map<Long, List<Long>> byQuestion = new HashMap<>();
        for (Answer answer : answers) {
            if (answer == null || answer.questionId() == null || answer.optionIds() == null
                    || byQuestion.putIfAbsent(answer.questionId(), answer.optionIds()) != null) {
                throw badRequest("Для каждого вопроса отправьте один ответ.");
            }
        }
        for (Question question : questions) {
            List<Long> selected = byQuestion.get(question.id());
            if (selected == null || selected.isEmpty() || (question.choiceType() == ChoiceType.SINGLE && selected.size() != 1)
                    || new HashSet<>(selected).size() != selected.size()
                    || !question.options().stream().map(Option::id).toList().containsAll(selected)) {
                throw badRequest("Выберите допустимые варианты для каждого вопроса.");
            }
        }
        return byQuestion.values().stream().flatMap(List::stream).toList();
    }

    private static String required(String value, int limit, String message) {
        if (value == null || value.isBlank() || value.strip().length() > limit) throw badRequest(message);
        return value.strip();
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    private static ResponseStatusException conflict(String message) {
        return new ResponseStatusException(HttpStatus.CONFLICT, message);
    }
}

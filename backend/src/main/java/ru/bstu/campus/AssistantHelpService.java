package ru.bstu.campus;

import static ru.bstu.campus.StudentDeadlineService.PERIODS;
import static ru.bstu.campus.StudentDeadlineService.SUMMARY_TOOL;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.MatchResult;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
class AssistantHelpService {
    private static final int MAX_QUESTION_LENGTH = 2000;
    private static final int MAX_ANSWER_LENGTH = 3000;
    private static final Pattern WORD = Pattern.compile("[\\p{L}\\p{N}]{2,}");
    private static final Set<String> STOP_WORDS = Set.of(
        "как", "где", "куда", "когда", "что", "можно", "подскажи", "покажи", "найти", "мне",
        "меня", "мой", "мои", "для", "или", "этот", "эта", "все", "уже", "еще", "будет",
        "нужно", "через", "после", "при", "свой", "свои", "система", "кабинет", "почему");
    private static final String INSTRUCTIONS = """
        Ты справочный помощник университетской среды БГТУ. Отвечай по-русски и опирайся только на разделы справки ниже.
        Назови нужный раздел интерфейса и дай короткую последовательность действий.
        Если справки недостаточно, скажи, что уточнить. Используй обычный текст без HTML, Markdown и адресов.
        У тебя нет доступа к аккаунтам, спискам людей и файлам. Не говори, что выполнил действие.
        """;
    private static final String STUDENT_INSTRUCTIONS = """
        Ты помощник студента в университетской среде БГТУ. Отвечай по-русски.
        Если студент спрашивает о своих заданиях, сроках, статусах сдачи, текущем АР или списаниях,
        вызови предоставленный инструмент. Он сам покажет данные вошедшему студенту.
        Выбирай период по смыслу вопроса: active для текущих заданий или личного АР без дат,
        this_week для этой календарной недели, next_week для следующей календарной недели,
        next_7_days для ближайших семи дней. Если указан другой период, назови доступные периоды.
        Если студент спрашивает, как или куда загрузить решение, как пользоваться системой или по каким правилам
        работает АР, дай короткую инструкцию по справке без вызова инструмента. Ориентируйся на смысл вопроса.
        Если вопрос вне темы или информации в справке нет, скажи об этом и при необходимости задай один вопрос.
        Не выдумывай задания, оценки, даты, названия разделов или ссылки. Не выполняй действия от имени студента.
        Пиши обычным текстом без HTML, Markdown и адресов. Не выводи JSON и служебные имена функций.
        """;
    private static final String HELP_HEADER = "\nСтатьи справки:\n";
    private static final Map<String, Object> STUDENT_SUMMARY_FUNCTION = Map.of(
        "name", SUMMARY_TOOL,
        "description", "Показывает собственные задания, дедлайны, статусы, академический рейтинг и списания студента.",
        "parameters", Map.of(
            "type", "object",
            "properties", Map.of("period", Map.of("type", "string", "enum", PERIODS.keySet().stream().sorted().toList())),
            "required", List.of("period"),
            "additionalProperties", false));

    private final JsonMapper json;
    private final OpenAiChatClient llm;
    private final List<IndexedArticle> index;

    AssistantHelpService(JsonMapper json, OpenAiChatClient llm) throws IOException {
        this.json = json;
        this.llm = llm;
        var resource = new ClassPathResource("assistant/help.json");
        index = Arrays.stream(json.readValue(resource.getContentAsString(StandardCharsets.UTF_8), Article[].class))
            .map(article -> new IndexedArticle(article, terms(article.title() + " " + article.keywords()), terms(article.text())))
            .toList();
    }

    record Source(String title, String path) {}
    record Answer(String answer, List<Source> sources, Mode mode, String studentPeriod) {
        Answer(String answer, List<Source> sources, Mode mode) {
            this(answer, sources, mode, null);
        }
    }
    enum Mode { MODEL, GUIDE }

    private record Article(String title, String path, Set<String> roles, String keywords, String text) {}
    private record IndexedArticle(Article article, Set<String> keywords, Set<String> content) {
        int score(Set<String> query) {
            return query.stream().mapToInt(term -> keywords.contains(term) ? 4 : content.contains(term) ? 1 : 0).sum();
        }
    }
    private record Match(Article article, int score) {}

    Answer ask(String question, Set<String> roles) {
        String input = question == null ? "" : question.strip();
        if (input.isEmpty() || input.length() > MAX_QUESTION_LENGTH) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Введите вопрос длиной до 2000 символов.");
        }
        var query = terms(input);
        var availableArticles = index.stream()
            .filter(entry -> entry.article().roles().stream().anyMatch(roles::contains))
            .toList();
        var ranked = availableArticles.stream()
            .map(entry -> new Match(entry.article(), entry.score(query)))
            .filter(match -> match.score() >= 4)
            .sorted(Comparator.comparingInt(Match::score).reversed())
            .limit(3).toList();
        int threshold = ranked.isEmpty() ? 4 : Math.max(4, (ranked.getFirst().score() * 2 + 2) / 3);
        var passages = ranked.stream().filter(match -> match.score() >= threshold).map(Match::article).toList();
        var sources = passages.stream().map(article -> new Source(article.title(), article.path())).toList();
        boolean student = roles.contains("ROLE_STUDENT");
        if (llm.available()) {
            try {
                if (student) {
                    var context = availableArticles.stream().map(IndexedArticle::article).toList();
                    var response = askStudent(input, context, sources);
                    if (response != null) return response;
                } else if (!passages.isEmpty()) {
                    String answer = llm.complete(INSTRUCTIONS + helpContext(passages), input, false, 750, Duration.ofSeconds(25));
                    if (answer.length() <= MAX_ANSWER_LENGTH) return new Answer(answer, sources, Mode.MODEL);
                }
            } catch (ResponseStatusException unavailable) {
                // The vetted articles remain available while the model is unavailable.
            }
        }
        if (passages.isEmpty()) {
            String message = student
                ? "По этому вопросу ответа в справке нет. Личные задания и АР можно открыть через «Мои дедлайны и рейтинг»."
                : "Уточните, о каком разделе или действии в системе вы спрашиваете.";
            return new Answer(message, List.of(), Mode.GUIDE);
        }
        var guide = passages.stream().map(Article::text).collect(Collectors.joining("\n\n"));
        return new Answer(guide, sources, Mode.GUIDE);
    }

    private Answer askStudent(String input, List<Article> articles, List<Source> sources) {
        var message = llm.completeWithTool(STUDENT_INSTRUCTIONS + helpContext(articles), input,
            STUDENT_SUMMARY_FUNCTION, 750, Duration.ofSeconds(18));
        var calls = message.path("tool_calls");
        if (!calls.isMissingNode() && !calls.isNull() && !(calls.isArray() && calls.isEmpty())) {
            String period = studentPeriod(calls);
            return period == null ? null : new Answer("", List.of(), Mode.MODEL, period);
        }
        String answer = message.path("content").stringValue("").strip();
        if (looksLikeToolSyntax(answer)) {
            // Some providers print an attempted function call as text. Only native calls can open a summary.
            answer = llm.complete(INSTRUCTIONS + helpContext(articles), input, false, 750, Duration.ofSeconds(7));
        }
        if (answer.isEmpty() || answer.length() > MAX_ANSWER_LENGTH || looksLikeToolSyntax(answer)) return null;
        return new Answer(answer, sources, Mode.MODEL);
    }

    private static boolean looksLikeToolSyntax(String answer) {
        return answer.startsWith("{") || answer.startsWith("[") || answer.contains("```") || answer.contains(SUMMARY_TOOL);
    }

    private String studentPeriod(JsonNode calls) {
        if (!calls.isArray() || calls.size() != 1) return null;
        var call = calls.path(0);
        var function = call.path("function");
        if (!"function".equals(call.path("type").stringValue()) || !SUMMARY_TOOL.equals(function.path("name").stringValue())) {
            return null;
        }
        try {
            var arguments = json.readTree(function.path("arguments").stringValue(""));
            if (arguments == null || !arguments.isObject() || arguments.size() != 1) return null;
            String period = arguments.path("period").stringValue("");
            return PERIODS.containsKey(period) ? period : null;
        } catch (JacksonException invalid) {
            return null;
        }
    }

    private static String helpContext(List<Article> articles) {
        return HELP_HEADER + articles.stream().map(article -> article.title() + "\n" + article.text())
            .collect(Collectors.joining("\n\n"));
    }

    private static Set<String> terms(String text) {
        return WORD.matcher(text.toLowerCase(Locale.ROOT).replace('ё', 'е')).results()
            .map(MatchResult::group)
            .filter(word -> !STOP_WORDS.contains(word))
            .map(word -> word.substring(0, Math.min(5, word.length())))
            .collect(Collectors.toUnmodifiableSet());
    }
}

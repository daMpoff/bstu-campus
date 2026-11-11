package ru.bstu.campus;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.MatchResult;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

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
        Статьи справки:
        """;

    private final OpenAiChatClient llm;
    private final List<IndexedArticle> index;

    AssistantHelpService(JsonMapper json, OpenAiChatClient llm) throws IOException {
        this.llm = llm;
        var resource = new ClassPathResource("assistant/help.json");
        index = Arrays.stream(json.readValue(resource.getContentAsString(StandardCharsets.UTF_8), Article[].class))
            .map(article -> new IndexedArticle(article, terms(article.title() + " " + article.keywords()), terms(article.text())))
            .toList();
    }

    record Source(String title, String path) {}
    record Answer(String answer, List<Source> sources, Mode mode) {}
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
        var ranked = index.stream()
            .filter(entry -> entry.article().roles().stream().anyMatch(roles::contains))
            .map(entry -> new Match(entry.article(), entry.score(query)))
            .filter(match -> match.score() >= 4)
            .sorted(Comparator.comparingInt(Match::score).reversed())
            .limit(3).toList();
        if (ranked.isEmpty()) {
            return new Answer("Уточните, о каком разделе или действии в системе вы спрашиваете.", List.of(), Mode.GUIDE);
        }
        int threshold = Math.max(4, (ranked.getFirst().score() * 2 + 2) / 3);
        var passages = ranked.stream().filter(match -> match.score() >= threshold).map(Match::article).toList();
        var sources = passages.stream().map(article -> new Source(article.title(), article.path())).toList();
        if (llm.available()) {
            var context = passages.stream().map(article -> article.title() + "\n" + article.text())
                .collect(Collectors.joining("\n\n"));
            try {
                String answer = llm.complete(INSTRUCTIONS + context, input, false, 750, Duration.ofSeconds(25));
                if (answer.length() <= MAX_ANSWER_LENGTH) return new Answer(answer, sources, Mode.MODEL);
            } catch (ResponseStatusException unavailable) {
                // The vetted articles remain available while the model is unavailable.
            }
        }
        var guide = passages.stream().map(Article::text).collect(Collectors.joining("\n\n"));
        return new Answer(guide, sources, Mode.GUIDE);
    }

    private static Set<String> terms(String text) {
        return WORD.matcher(text.toLowerCase(Locale.ROOT).replace('ё', 'е')).results()
            .map(MatchResult::group)
            .filter(word -> !STOP_WORDS.contains(word))
            .map(word -> word.substring(0, Math.min(5, word.length())))
            .collect(Collectors.toUnmodifiableSet());
    }
}

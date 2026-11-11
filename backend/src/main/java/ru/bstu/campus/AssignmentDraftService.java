package ru.bstu.campus;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
class AssignmentDraftService {
    private static final String INSTRUCTIONS = """
        Подготовь черновик учебного задания на русском языке по тезисам преподавателя.
        Верни JSON с текстовыми полями title (до 160 символов) и description (до 5000 символов).
        Описание: 4–7 коротких предложений о цели, шагах, результате и способе сдачи из тезисов.
        Используй простой текст без HTML и Markdown. Не добавляй инструменты, сроки, баллы и форматы, которых нет в тезисах.
        """;

    private final JsonMapper json;
    private final HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
    private final URI endpoint;
    private final String model;
    private final String apiKey;
    private final String reasoningEffort;

    AssignmentDraftService(JsonMapper json, @Value("${campus.llm.url:}") String url,
                           @Value("${campus.llm.model:}") String model,
                           @Value("${campus.llm.api-key:}") String apiKey,
                           @Value("${campus.llm.reasoning-effort:}") String reasoningEffort) {
        this.json = json;
        this.endpoint = endpoint(url);
        this.model = model.strip();
        this.apiKey = apiKey.strip();
        this.reasoningEffort = reasoningEffort.strip();
    }

    record Draft(String title, String description) {}

    boolean available() {
        return endpoint != null && !model.isEmpty();
    }

    Draft generate(String notes) {
        if (!available()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Модель для черновиков не подключена.");
        }
        String brief = notes == null ? "" : notes.strip();
        if (brief.isEmpty() || brief.length() > 4000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Введите тезисы длиной до 4000 символов.");
        }

        try {
            var payload = new HashMap<String, Object>(Map.of(
                "model", model, "max_tokens", 1200,
                "response_format", Map.of("type", "json_object"),
                "messages", List.of(Map.of("role", "system", "content", INSTRUCTIONS),
                                    Map.of("role", "user", "content", brief))));
            if (!reasoningEffort.isEmpty()) payload.put("reasoning_effort", reasoningEffort);
            HttpRequest.Builder request = HttpRequest.newBuilder(endpoint)
                .timeout(Duration.ofSeconds(60))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(payload)));
            if (!apiKey.isEmpty()) request.header("Authorization", "Bearer " + apiKey);

            HttpResponse<String> response = client.send(request.build(), HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() / 100 != 2) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Модель не приняла запрос. Попробуйте позже.");
            }
            JsonNode message = json.readTree(response.body()).path("choices").path(0).path("message");
            JsonNode result = json.readTree(message.path("content").stringValue(""));
            return new Draft(text(result, "title", 160), text(result, "description", 5000));
        } catch (HttpTimeoutException failure) {
            throw new ResponseStatusException(HttpStatus.GATEWAY_TIMEOUT, "Модель не ответила вовремя. Попробуйте позже.");
        } catch (IOException | IllegalArgumentException failure) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Не удалось связаться с моделью. Попробуйте позже.");
        } catch (JacksonException failure) {
            throw invalidDraft();
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Запрос к модели прерван. Попробуйте снова.");
        }
    }

    private static URI endpoint(String url) {
        try {
            URI uri = URI.create(url.strip());
            if (uri.getHost() != null && uri.getUserInfo() == null && uri.getFragment() == null
                && ("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))) {
                return uri;
            }
        } catch (IllegalArgumentException invalid) {
            return null;
        }
        return null;
    }

    private static String text(JsonNode result, String field, int maxLength) {
        String text = result.path(field).stringValue("").strip();
        if (text.isEmpty() || text.length() > maxLength) throw invalidDraft();
        return text;
    }

    private static ResponseStatusException invalidDraft() {
        return new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Модель вернула неполный черновик. Попробуйте ещё раз.");
    }
}

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
import java.util.Locale;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

@Component
class OpenAiChatClient {
    private static final String OPENAI = "https://api.openai.com/v1";
    private static final String OLLAMA = "http://localhost:11434/v1";
    private static final String COMPLETIONS = "/chat/completions";

    private final JsonMapper json;
    private final HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
    private final URI endpoint;
    private final String model;
    private final String apiKey;
    private final String reasoningEffort;
    private final String tokenField;
    private final boolean jsonMode;
    private final boolean officialOpenAi;
    private final boolean available;

    OpenAiChatClient(JsonMapper json, LlmProperties settings) {
        this.json = json;
        String provider = clean(settings.provider()).toLowerCase(Locale.ROOT);
        String baseUrl = clean(settings.baseUrl());
        String fullUrl = clean(settings.url());
        endpoint = switch (provider) {
            case "", "auto" -> baseUrl.isEmpty() ? httpUri(fullUrl) : fromBase(baseUrl);
            case "ollama" -> fromBase(baseUrl.isEmpty() ? OLLAMA : baseUrl);
            case "openai" -> fromBase(OPENAI);
            case "openai-compatible" -> fromBase(baseUrl);
            default -> null;
        };
        model = clean(settings.model());
        apiKey = "ollama".equals(provider) ? "" : clean(settings.apiKey());
        reasoningEffort = clean(settings.reasoningEffort());
        jsonMode = settings.jsonMode();
        officialOpenAi = endpoint != null && "api.openai.com".equalsIgnoreCase(endpoint.getHost());
        tokenField = switch (clean(settings.tokenField())) {
            case "max_tokens" -> "max_tokens";
            case "max_completion_tokens" -> "max_completion_tokens";
            default -> officialOpenAi ? "max_completion_tokens" : "max_tokens";
        };
        available = endpoint != null && !model.isEmpty() && (!officialOpenAi
            || (!apiKey.isEmpty() && "https".equalsIgnoreCase(endpoint.getScheme())));
    }

    boolean available() {
        return available;
    }

    String complete(String instructions, String question, boolean jsonOutput, int maxTokens, Duration timeout) {
        if (!available) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Языковая модель не подключена.");
        }
        var payload = new HashMap<String, Object>(Map.of(
            "model", model,
            tokenField, maxTokens,
            "messages", List.of(Map.of("role", officialOpenAi ? "developer" : "system", "content", instructions),
                                Map.of("role", "user", "content", question))));
        if (jsonOutput && jsonMode) payload.put("response_format", Map.of("type", "json_object"));
        if (!reasoningEffort.isEmpty()) payload.put("reasoning_effort", reasoningEffort);
        if (officialOpenAi) payload.put("store", false);

        try {
            var request = HttpRequest.newBuilder(endpoint)
                .timeout(timeout)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(payload)));
            if (!apiKey.isEmpty()) request.header("Authorization", "Bearer " + apiKey);
            var response = client.send(request.build(), HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() / 100 != 2) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Модель не приняла запрос. Попробуйте позже.");
            }
            String answer = json.readTree(response.body()).path("choices").path(0).path("message")
                .path("content").stringValue("").strip();
            if (answer.isEmpty()) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Модель вернула пустой ответ. Попробуйте ещё раз.");
            }
            return answer;
        } catch (HttpTimeoutException failure) {
            throw new ResponseStatusException(HttpStatus.GATEWAY_TIMEOUT, "Модель не ответила вовремя. Попробуйте позже.");
        } catch (IOException | IllegalArgumentException | JacksonException failure) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Не удалось получить ответ модели. Попробуйте позже.");
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Запрос к модели прерван. Попробуйте снова.");
        }
    }

    private static URI fromBase(String value) {
        URI base = httpUri(value);
        if (base == null || base.getQuery() != null) return null;
        String url = value.replaceAll("/+$", "");
        return httpUri(url.endsWith(COMPLETIONS) ? url : url + COMPLETIONS);
    }

    private static URI httpUri(String value) {
        try {
            URI uri = URI.create(value);
            if (uri.getHost() != null && uri.getUserInfo() == null && uri.getFragment() == null
                && ("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))) {
                return uri;
            }
        } catch (IllegalArgumentException invalid) {
            return null;
        }
        return null;
    }

    private static String clean(String value) {
        return value == null ? "" : value.strip();
    }
}

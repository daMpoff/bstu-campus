package ru.bstu.campus;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Component
class TelegramBotApi {
    private static final int POLL_SECONDS = 15;
    private final HttpClient http;
    private final JsonMapper json;
    private final String endpoint;
    private final Long botId;
    private final String expectedUsername;
    private volatile String verifiedUsername;

    TelegramBotApi(JsonMapper json, @Value("${campus.telegram.bot-token:}") String rawToken,
                   @Value("${campus.telegram.bot-username:}") String rawUsername,
                   @Value("${campus.telegram.api-base-url:https://api.telegram.org}") URI base) {
        this.json = json;
        String token = rawToken.strip();
        if (!token.isEmpty() && !token.matches("[1-9][0-9]{0,17}:[a-zA-Z0-9_-]+")) {
            throw new IllegalArgumentException("Проверьте CAMPUS_TELEGRAM_BOT_TOKEN.");
        }
        if (base.getHost() == null || base.getUserInfo() != null || base.getQuery() != null || base.getFragment() != null
            || !Set.of("http", "https").contains(base.getScheme())) {
            throw new IllegalArgumentException("Проверьте CAMPUS_TELEGRAM_API_BASE_URL.");
        }
        String username = rawUsername.strip().replaceFirst("^@", "");
        if (!username.isEmpty() && !username.matches("[a-zA-Z0-9_]{5,32}")) {
            throw new IllegalArgumentException("Проверьте CAMPUS_TELEGRAM_BOT_USERNAME.");
        }
        expectedUsername = username;
        botId = token.isEmpty() ? null : Long.parseLong(token.substring(0, token.indexOf(':')));
        endpoint = base.toString().replaceFirst("/+$", "") + "/bot" + token + "/";
        http = botId == null ? null : HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4))
            .followRedirects(HttpClient.Redirect.NEVER).build();
    }

    boolean hasToken() { return botId != null; }
    boolean configured() { return verifiedUsername != null; }
    long botId() { return botId; }
    String botUsername() { return verifiedUsername; }

    boolean verifyIdentity() {
        JsonNode identity = request("getMe", Map.of(), Duration.ofSeconds(8));
        String username = identity.path("username").stringValue("");
        if (identity.path("id").longValue(0) != botId() || !identity.path("is_bot").booleanValue(false)
            || !username.matches("[a-zA-Z0-9_]{5,32}")
            || (!expectedUsername.isEmpty() && !expectedUsername.equalsIgnoreCase(username))) return false;
        verifiedUsername = username;
        return true;
    }

    JsonNode updates(Long offset) {
        var payload = new HashMap<String, Object>(Map.of("timeout", POLL_SECONDS, "limit", 50,
            "allowed_updates", List.of("message")));
        if (offset != null) payload.put("offset", offset);
        JsonNode updates = request("getUpdates", payload, Duration.ofSeconds(POLL_SECONDS + 8L));
        if (!updates.isArray()) throw new Failure(0, 0);
        return updates;
    }

    void send(long chatId, String message) {
        request("sendMessage", Map.of("chat_id", chatId, "text", message,
            "protect_content", true, "link_preview_options", Map.of("is_disabled", true)), Duration.ofSeconds(8));
    }

    private JsonNode request(String method, Map<String, Object> payload, Duration timeout) {
        try {
            var request = HttpRequest.newBuilder(URI.create(endpoint + method)).timeout(timeout)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(payload))).build();
            var response = http.send(request, HttpResponse.BodyHandlers.ofString());
            var result = json.readTree(response.body());
            if (response.statusCode() / 100 != 2 || !result.path("ok").booleanValue(false)) {
                throw new Failure(result.path("error_code").intValue(response.statusCode()),
                    result.path("parameters").path("retry_after").intValue(0));
            }
            return result.path("result");
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new Failure(0, 0);
        } catch (IOException | IllegalArgumentException | JacksonException unavailable) {
            // The token is part of the request URL. Keep transport errors out of application logs.
            throw new Failure(0, 0);
        }
    }

    static final class Failure extends RuntimeException {
        private final int status;
        private final int retryAfter;

        private Failure(int status, int retryAfter) {
            super("Telegram Bot API недоступен. Код: " + status);
            this.status = status;
            this.retryAfter = Math.max(0, retryAfter);
        }

        int status() { return status; }
        int retryAfter() { return retryAfter; }
    }
}

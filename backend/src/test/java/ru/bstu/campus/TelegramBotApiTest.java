package ru.bstu.campus;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class TelegramBotApiTest {
    private final JsonMapper json = JsonMapper.builder().build();
    private final AtomicReference<JsonNode> sendBody = new AtomicReference<>();
    private final AtomicReference<JsonNode> pollBody = new AtomicReference<>();
    private HttpServer server;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/bot12345:fakeToken/getMe", exchange -> {
            byte[] body = """
                {"ok":true,"result":{"id":12345,"is_bot":true,"username":"Campus_Test_Bot"}}
                """.getBytes(StandardCharsets.UTF_8);
            try (exchange) {
                exchange.sendResponseHeaders(200, body.length);
                exchange.getResponseBody().write(body);
            }
        });
        server.createContext("/bot12345:fakeToken/getUpdates", exchange -> {
            byte[] body = """
                {"ok":true,"result":[]}
                """.getBytes(StandardCharsets.UTF_8);
            try (exchange) {
                pollBody.set(json.readTree(exchange.getRequestBody()));
                exchange.sendResponseHeaders(200, body.length);
                exchange.getResponseBody().write(body);
            }
        });
        server.createContext("/bot12345:fakeToken/sendMessage", exchange -> {
            byte[] body = """
                {"ok":false,"error_code":429,"description":"untrusted fakeToken","parameters":{"retry_after":61}}
                """.getBytes(StandardCharsets.UTF_8);
            try (exchange) {
                sendBody.set(json.readTree(exchange.getRequestBody()));
                exchange.sendResponseHeaders(429, body.length);
                exchange.getResponseBody().write(body);
            }
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        if (server != null) server.stop(0);
    }

    @Test
    void onlyVerifiedExpectedBotEnablesTheChannel() {
        TelegramBotApi otherBot = bot("@other_bot");
        assertThat(otherBot.verifyIdentity()).isFalse();
        assertThat(otherBot.configured()).isFalse();
        assertThat(otherBot.botUsername()).isNull();

        TelegramBotApi campusBot = bot("@campus_test_bot");
        assertThat(campusBot.configured()).isFalse();
        assertThat(campusBot.verifyIdentity()).isTrue();
        assertThat(campusBot.configured()).isTrue();
        assertThat(campusBot.botUsername()).isEqualTo("Campus_Test_Bot");
    }

    @Test
    void acknowledgesProcessedUpdatesAndRespectsRetryAfter() {
        TelegramBotApi api = bot("campus_test_bot");
        assertThat(api.updates(420L).isArray()).isTrue();
        assertThat(pollBody.get().path("offset").longValue()).isEqualTo(420L);
        assertThat(pollBody.get().path("allowed_updates").path(0).stringValue()).isEqualTo("message");

        long chatId = 4_294_967_296L;
        assertThatThrownBy(() -> api.send(chatId, "Новая активность"))
            .isInstanceOfSatisfying(TelegramBotApi.Failure.class, failure -> {
                assertThat(failure.status()).isEqualTo(429);
                assertThat(failure.retryAfter()).isEqualTo(61);
                assertThat(failure).hasMessageNotContaining("fakeToken");
            });
        assertThat(sendBody.get().path("chat_id").longValue()).isEqualTo(chatId);
        assertThat(sendBody.get().path("protect_content").booleanValue()).isTrue();
    }

    private TelegramBotApi bot(String username) {
        return new TelegramBotApi(json, "12345:fakeToken", username,
            URI.create("http://127.0.0.1:" + server.getAddress().getPort()));
    }
}

package ru.bstu.campus;

import static org.junit.jupiter.api.Assertions.*;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class AssignmentDraftServiceTest {
    private final JsonMapper json = JsonMapper.builder().build();
    private final AtomicReference<ProviderRequest> sent = new AtomicReference<>();
    private HttpServer provider;

    record ProviderRequest(String method, String authorization, JsonNode body) {}

    @AfterEach
    void stopProvider() {
        if (provider != null) provider.stop(0);
    }

    @Test
    void generatesEditableDraftThroughConfiguredProvider() throws IOException {
        String completion = json.writeValueAsString(Map.of("choices", List.of(Map.of("message", Map.of(
            "content", json.writeValueAsString(Map.of("title", "Запросы SQL", "description", "Напишите три запроса.")))))));
        var service = service(200, completion);

        assertTrue(service.available());
        var draft = service.generate("  Три запроса SELECT, сдать SQL-файл.  ");

        assertEquals("Запросы SQL", draft.title());
        assertEquals("Напишите три запроса.", draft.description());
        assertEquals("POST", sent.get().method());
        assertEquals("Bearer test-key", sent.get().authorization());
        JsonNode body = sent.get().body();
        assertEquals("test-model", body.path("model").stringValue());
        assertEquals("none", body.path("reasoning_effort").stringValue());
        assertEquals("json_object", body.path("response_format").path("type").stringValue());
        assertEquals(2, body.path("messages").size());
        assertEquals("Три запроса SELECT, сдать SQL-файл.", body.path("messages").path(1).path("content").stringValue());
    }

    @Test
    void rejectsEmptyAndOversizedNotesBeforeCallingProvider() throws IOException {
        var service = service(200, "{}");
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ResponseStatusException.class, () -> service.generate("  ")).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ResponseStatusException.class, () -> service.generate("а".repeat(4001))).getStatusCode());
        assertNull(sent.get());
    }

    @Test
    void reportsUnconfiguredProvider() {
        var service = new AssignmentDraftService(json, "", "", "", "");
        assertFalse(service.available());
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE,
            assertThrows(ResponseStatusException.class, () -> service.generate("Тезис")).getStatusCode());
    }

    @Test
    void rejectsIncompleteProviderOutput() throws IOException {
        var service = service(200, "{\"choices\":[]}");
        assertEquals(HttpStatus.BAD_GATEWAY,
            assertThrows(ResponseStatusException.class, () -> service.generate("Тезис")).getStatusCode());
    }

    @Test
    void doesNotExposeProviderErrorBody() throws IOException {
        var service = service(429, "{\"detail\":\"provider-account-data\"}");
        var failure = assertThrows(ResponseStatusException.class, () -> service.generate("Тезис"));
        assertEquals(HttpStatus.BAD_GATEWAY, failure.getStatusCode());
        assertFalse(failure.getMessage().contains("provider-account-data"));
    }

    private AssignmentDraftService service(int status, String response) throws IOException {
        provider = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        provider.createContext("/v1/chat/completions", exchange -> {
            try (exchange) {
                sent.set(new ProviderRequest(exchange.getRequestMethod(), exchange.getRequestHeaders().getFirst("Authorization"),
                    json.readTree(exchange.getRequestBody())));
                byte[] body = response.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
                exchange.sendResponseHeaders(status, body.length);
                exchange.getResponseBody().write(body);
            }
        });
        provider.start();
        return new AssignmentDraftService(json, "http://127.0.0.1:" + provider.getAddress().getPort() + "/v1/chat/completions",
            "test-model", "test-key", "none");
    }
}

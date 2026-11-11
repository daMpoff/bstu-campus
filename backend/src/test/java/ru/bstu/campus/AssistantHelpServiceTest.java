package ru.bstu.campus;

import static org.junit.jupiter.api.Assertions.*;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class AssistantHelpServiceTest {
    private final JsonMapper json = JsonMapper.builder().build();
    private final AtomicReference<JsonNode> request = new AtomicReference<>();
    private final AtomicReference<String> authorization = new AtomicReference<>();
    private HttpServer provider;

    @AfterEach
    void stopProvider() {
        if (provider != null) provider.stop(0);
    }

    @Test
    void retrievesRelevantRoleScopedInstructionsWithoutModel() throws IOException {
        var service = new AssistantHelpService(json, new OpenAiChatClient(json,
            new LlmProperties("auto", "", "", "", "", "", true, "")));
        var student = service.ask("Как сдать файл и что будет после сдачи?", Set.of("ROLE_STUDENT"));
        assertEquals(AssistantHelpService.Mode.GUIDE, student.mode());
        assertTrue(student.answer().contains("Сдать работу"));
        assertEquals(List.of(new AssistantHelpService.Source("Сдача работы", "/assignments")), student.sources());

        var teacher = service.ask("Где скачать файл, который сдал студент?", Set.of("ROLE_TEACHER"));
        assertEquals("/review", teacher.sources().getFirst().path());
        assertFalse(teacher.answer().contains("Сдать работу"));

        var restricted = service.ask("Как импортировать CSV?", Set.of("ROLE_STUDENT"));
        assertTrue(restricted.sources().isEmpty());
        var admin = service.ask("Как импортировать CSV?", Set.of("ROLE_ADMIN"));
        assertEquals(List.of(new AssistantHelpService.Source("Импорт CSV", "/admin?tab=import")), admin.sources());
    }

    @Test
    void sendsQuestionAndOnlySelectedHelpToExternalCompatibleEndpoint() throws IOException {
        String answer = "Откройте «Задания», затем выберите работу.";
        var service = service(200, completion(answer));

        var result = service.ask("Как сдать задание с файлом?", Set.of("ROLE_STUDENT"));
        assertEquals(AssistantHelpService.Mode.MODEL, result.mode());
        assertEquals(answer, result.answer());
        assertEquals(List.of(new AssistantHelpService.Source("Сдача работы", "/assignments")), result.sources());
        assertEquals("Bearer fixture-key", authorization.get());
        var payload = request.get();
        assertEquals("fixture-model", payload.path("model").stringValue());
        assertEquals(750, payload.path("max_completion_tokens").intValue());
        assertFalse(payload.has("max_tokens"));
        assertFalse(payload.has("response_format"));
        assertFalse(payload.has("tools"));
        var messages = payload.path("messages");
        assertEquals("system", messages.path(0).path("role").stringValue());
        assertTrue(messages.path(0).path("content").stringValue().contains("Сдать работу"));
        assertFalse(messages.path(0).path("content").stringValue().contains("Импорт CSV"));
        assertEquals("Как сдать задание с файлом?", messages.path(1).path("content").stringValue());
    }

    @Test
    void keepsHelpAvailableOnProviderErrorAndDoesNotSendUnrelatedQuestions() throws IOException {
        var service = service(429, "{ \"detail\": \"provider-account-data\" }");
        var unrelated = service.ask("Какая погода в Брянске?", Set.of("ROLE_STUDENT"));
        assertEquals(AssistantHelpService.Mode.GUIDE, unrelated.mode());
        assertTrue(unrelated.sources().isEmpty());
        assertNull(request.get());

        var result = service.ask("Почему списали АР после дедлайна?", Set.of("ROLE_STUDENT"));
        assertEquals(AssistantHelpService.Mode.GUIDE, result.mode());
        assertTrue(result.answer().contains("списание"));
        assertFalse(result.answer().contains("provider-account-data"));
        assertFalse(result.sources().isEmpty());
    }

    @Test
    void rejectsEmptyOrOversizedQuestionsBeforeProviderCall() throws IOException {
        var service = service(200, completion("Ответ"));
        for (String invalid : new String[] {null, "  ", "а".repeat(2001)}) {
            var error = assertThrows(ResponseStatusException.class, () -> service.ask(invalid, Set.of("ROLE_STUDENT")));
            assertEquals(HttpStatus.BAD_REQUEST, error.getStatusCode());
        }
        assertNull(request.get());
    }

    private String completion(String text) {
        return json.writeValueAsString(Map.of("choices", List.of(Map.of("message", Map.of("content", text)))));
    }

    private AssistantHelpService service(int status, String response) throws IOException {
        provider = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        provider.createContext("/proxy/v1/chat/completions", exchange -> {
            try (exchange) {
                authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
                request.set(json.readTree(exchange.getRequestBody()));
                byte[] body = response.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
                exchange.sendResponseHeaders(status, body.length);
                exchange.getResponseBody().write(body);
            }
        });
        provider.start();
        String base = "http://127.0.0.1:" + provider.getAddress().getPort() + "/proxy/v1/";
        var settings = new LlmProperties("openai-compatible", "http://127.0.0.1:1/legacy", base,
            "fixture-model", "fixture-key", "", true, "max_completion_tokens");
        return new AssistantHelpService(json, new OpenAiChatClient(json, settings));
    }
}

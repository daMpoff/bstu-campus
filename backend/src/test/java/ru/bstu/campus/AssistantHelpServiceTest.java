package ru.bstu.campus;

import static org.junit.jupiter.api.Assertions.*;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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

        var result = service.ask("Где скачать файл, который сдал студент?", Set.of("ROLE_TEACHER"));
        assertEquals(AssistantHelpService.Mode.MODEL, result.mode());
        assertEquals(answer, result.answer());
        assertEquals(List.of(new AssistantHelpService.Source("Проверка работ и вложения", "/review")), result.sources());
        assertNull(result.studentPeriod());
        assertEquals("Bearer fixture-key", authorization.get());
        var payload = request.get();
        assertEquals("fixture-model", payload.path("model").stringValue());
        assertEquals(750, payload.path("max_completion_tokens").intValue());
        assertFalse(payload.has("max_tokens"));
        assertFalse(payload.has("response_format"));
        assertFalse(payload.has("tools"));
        var messages = payload.path("messages");
        assertEquals("system", messages.path(0).path("role").stringValue());
        assertTrue(messages.path(0).path("content").stringValue().contains("Поддерживаемые вложения"));
        assertFalse(messages.path(0).path("content").stringValue().contains("Импорт CSV"));
        assertEquals("Где скачать файл, который сдал студент?", messages.path(1).path("content").stringValue());
    }

    @Test
    void offersStudentSummaryToModelEvenWithoutHelpKeywords() throws IOException {
        String question = "Что у меня ещё висит?";
        var service = service(200, toolCompletion("{\"period\":\"active\"}"));
        var result = service.ask(question, Set.of("ROLE_STUDENT"));

        assertEquals("active", result.studentPeriod());
        assertEquals(AssistantHelpService.Mode.MODEL, result.mode());
        assertTrue(result.answer().isEmpty());
        var payload = request.get();
        assertEquals(question, payload.at("/messages/1/content").stringValue());
        assertTrue(payload.at("/messages/0/content").stringValue().contains("Сдача работы"));
        assertFalse(payload.at("/messages/0/content").stringValue().contains("Импорт CSV"));
        assertEquals("auto", payload.path("tool_choice").stringValue());
        assertEquals("get_my_deadlines_and_rating", payload.at("/tools/0/function/name").stringValue());
        assertFalse(payload.at("/tools/0/function/parameters/additionalProperties").booleanValue(true));
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"period\":\"all_students\"}", "{\"period\":\"active\",\"email\":\"other@example.test\"}", "malformed"})
    void ignoresInvalidStudentSummaryArguments(String arguments) throws IOException {
        var service = service(200, toolCompletion(arguments));
        var result = service.ask("Что у меня ещё висит?", Set.of("ROLE_STUDENT"));

        assertNull(result.studentPeriod());
        assertEquals(AssistantHelpService.Mode.GUIDE, result.mode());
        assertTrue(result.answer().contains("Мои дедлайны и рейтинг"));
    }

    @Test
    void retriesWithoutToolsWhenProviderPrintsFunctionSyntax() throws IOException {
        String answer = "Откройте «Задания» и приложите решение.";
        var service = service(200, payload -> completion(payload.has("tools")
            ? "```json\n{\"name\":\"get_my_deadline_rating\"}\n```"
            : answer));
        var result = service.ask("Куда нажать, чтобы приложить решение?", Set.of("ROLE_STUDENT"));

        assertEquals(answer, result.answer());
        assertEquals(AssistantHelpService.Mode.MODEL, result.mode());
        assertNull(result.studentPeriod());
        assertFalse(request.get().has("tools"));
    }

    @Test
    void keepsHelpAvailableOnProviderErrorAndDoesNotSendUnrelatedQuestions() throws IOException {
        var service = service(429, "{ \"detail\": \"provider-account-data\" }");
        var unrelated = service.ask("Какая погода в Брянске?", Set.of("ROLE_TEACHER"));
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

    private String toolCompletion(String arguments) {
        var call = Map.of("type", "function", "function", Map.of("name", "get_my_deadlines_and_rating", "arguments", arguments));
        return json.writeValueAsString(Map.of("choices", List.of(Map.of("message", Map.of("tool_calls", List.of(call))))));
    }

    private AssistantHelpService service(int status, String response) throws IOException {
        return service(status, payload -> response);
    }

    private AssistantHelpService service(int status, Function<JsonNode, String> response) throws IOException {
        provider = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        provider.createContext("/proxy/v1/chat/completions", exchange -> {
            try (exchange) {
                authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
                var payload = json.readTree(exchange.getRequestBody());
                request.set(payload);
                byte[] body = response.apply(payload).getBytes(StandardCharsets.UTF_8);
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

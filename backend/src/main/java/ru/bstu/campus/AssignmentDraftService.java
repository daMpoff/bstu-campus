package ru.bstu.campus;

import java.time.Duration;

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
    private final OpenAiChatClient llm;

    AssignmentDraftService(JsonMapper json, OpenAiChatClient llm) {
        this.json = json;
        this.llm = llm;
    }

    record Draft(String title, String description) {}

    boolean available() {
        return llm.available();
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
            String answer = llm.complete(INSTRUCTIONS, brief, true, 1200, Duration.ofSeconds(60));
            String fence = "```";
            if (answer.startsWith(fence) && answer.endsWith(fence) && answer.indexOf('\n') > 0) {
                answer = answer.substring(answer.indexOf('\n') + 1, answer.length() - fence.length()).strip();
            }
            JsonNode result = json.readTree(answer);
            return new Draft(text(result, "title", 160), text(result, "description", 5000));
        } catch (JacksonException failure) {
            throw invalidDraft();
        }
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

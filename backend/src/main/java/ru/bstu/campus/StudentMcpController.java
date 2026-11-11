package ru.bstu.campus;

import static ru.bstu.campus.StudentDeadlineService.DEFAULT_PERIOD;
import static ru.bstu.campus.StudentDeadlineService.PERIODS;
import static ru.bstu.campus.StudentDeadlineService.SUMMARY_TOOL;

import java.io.IOException;
import java.util.Map;

import io.modelcontextprotocol.common.McpTransportContext;
import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.transport.HttpServletStatelessServerTransport;
import io.modelcontextprotocol.spec.McpSchema;
import jakarta.annotation.PreDestroy;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.WebUtils;
import tools.jackson.databind.json.JsonMapper;

@RestController
class StudentMcpController {
    private static final Logger log = LoggerFactory.getLogger(StudentMcpController.class);
    private static final String ENDPOINT = "/api/student/mcp";
    private static final String STUDENT_EMAIL = "studentEmail";
    private static final String PROTOCOL_VERSION = "MCP-Protocol-Version";

    private final HttpServletStatelessServerTransport transport;
    private final StudentDeadlineService deadlines;
    private final JsonMapper json;

    StudentMcpController(StudentDeadlineService deadlines, JsonMapper json) {
        this.deadlines = deadlines;
        this.json = json;
        this.transport = HttpServletStatelessServerTransport.builder()
            .messageEndpoint(ENDPOINT)
            .contextExtractor(StudentMcpController::context)
            .maxRequestSize(16 * 1024)
            .build();
        var inputSchema = Map.<String, Object>of(
            "type", "object",
            "properties", Map.of("period", Map.of("type", "string", "enum", PERIODS.keySet().stream().sorted().toList(),
                "default", DEFAULT_PERIOD, "description", "Период по московскому времени или active для всех активных заданий.")),
            "additionalProperties", false
        );
        var tool = McpSchema.Tool.builder(SUMMARY_TOOL, inputSchema)
            .title("Мои дедлайны и рейтинг")
            .description("Задания, сроки, статусы сдачи, списания и история АР вошедшего студента.")
            .annotations(McpSchema.ToolAnnotations.builder().readOnlyHint(true).openWorldHint(false).build())
            .build();
        McpServer.sync(transport)
            .serverInfo("bstu-campus-student", "1.0.0")
            .capabilities(McpSchema.ServerCapabilities.builder().tools(false).build())
            .toolCall(tool, this::summary)
            .build();
    }

    @RequestMapping(path = ENDPOINT, method = {RequestMethod.POST, RequestMethod.GET, RequestMethod.DELETE})
    void handle(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "private, no-store");
        if (!sameOrigin(request)) {
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            return;
        }
        String version = request.getHeader(PROTOCOL_VERSION);
        if (version != null && !transport.protocolVersions().contains(version)) {
            response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
            return;
        }
        transport.service((ServletRequest) request, response);
    }

    @PreDestroy
    void close() {
        transport.destroy();
    }

    private static boolean sameOrigin(HttpServletRequest request) {
        try {
            return WebUtils.isSameOrigin(new ServletServerHttpRequest(request));
        } catch (IllegalArgumentException malformedOrigin) {
            return false;
        }
    }

    private static McpTransportContext context(HttpServletRequest request) {
        var principal = request.getUserPrincipal();
        if (principal == null || !request.isUserInRole("STUDENT")) return McpTransportContext.EMPTY;
        return McpTransportContext.create(Map.of(STUDENT_EMAIL, principal.getName()));
    }

    private McpSchema.CallToolResult summary(McpTransportContext context, McpSchema.CallToolRequest request) {
        if (!(context.get(STUDENT_EMAIL) instanceof String email)) {
            return toolError("Войдите в кабинет студента.");
        }
        var arguments = request.arguments();
        Object value = arguments == null ? DEFAULT_PERIOD : arguments.getOrDefault("period", DEFAULT_PERIOD);
        var period = value instanceof String name ? PERIODS.get(name) : null;
        if (period == null) return toolError("Выберите доступный период.");

        try {
            var result = json.valueToTree(deadlines.summary(email, period));
            return McpSchema.CallToolResult.builder()
                .structuredContent(result)
                .addTextContent(json.writeValueAsString(result))
                .build();
        } catch (RuntimeException failure) {
            log.warn("Student deadlines query failed", failure);
            return toolError("Не удалось загрузить задания и рейтинг. Попробуйте ещё раз.");
        }
    }

    private static McpSchema.CallToolResult toolError(String message) {
        return McpSchema.CallToolResult.builder().isError(true).addTextContent(message).build();
    }
}

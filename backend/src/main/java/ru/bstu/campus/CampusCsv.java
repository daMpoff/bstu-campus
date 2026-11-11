package ru.bstu.campus;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

final class CampusCsv {
    private static final int MAX_ROWS = 500;
    static final int MAX_BYTES = 512 * 1024;

    record Row(int line, List<String> fields) {}

    private CampusCsv() {}

    static List<Row> read(byte[] bytes, List<String> header) {
        if (bytes.length > MAX_BYTES) throw invalid("Файл CSV должен быть не больше 512 КБ.");
        String csv;
        try {
            csv = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException invalidEncoding) {
            throw invalid("Сохраните CSV в кодировке UTF-8.");
        }
        if (csv.startsWith("\ufeff")) csv = csv.substring(1);
        csv = csv.replace("\r\n", "\n").replace('\r', '\n');
        String headerLine = csv.lines().filter(line -> !line.isBlank()).findFirst().orElse("");
        char delimiter = headerLine.indexOf(';') >= 0 ? ';' : ',';
        List<Row> rows = parse(csv, delimiter);
        if (rows.isEmpty() || !rows.getFirst().fields().stream().map(String::strip).toList().equals(header)) {
            throw invalid("Проверьте заголовок CSV. Ожидаются столбцы «" + String.join(", ", header) + "».");
        }
        List<Row> entries = rows.subList(1, rows.size());
        if (entries.isEmpty()) throw invalid("В CSV нет записей.");
        for (Row entry : entries) {
            if (entry.fields().size() != header.size()) throw at(entry, "неверное количество полей.");
        }
        return entries;
    }

    private static List<Row> parse(String csv, char delimiter) {
        List<Row> rows = new ArrayList<>();
        List<String> fields = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        boolean quoted = false;
        boolean closed = false;
        int line = 1;
        int startLine = 1;
        for (int i = 0; i <= csv.length(); i++) {
            boolean eof = i == csv.length();
            char value = eof ? '\n' : csv.charAt(i);
            if (quoted && value == '"') {
                if (i + 1 < csv.length() && csv.charAt(i + 1) == '"') {
                    field.append(value);
                    i++;
                } else {
                    quoted = false;
                    closed = true;
                }
            } else if (quoted) {
                if (eof) throw invalid("Строка " + startLine + " содержит незакрытые кавычки.");
                field.append(value);
                if (value == '\n') line++;
            } else if (value == delimiter || value == '\n') {
                fields.add(field.toString());
                field.setLength(0);
                closed = false;
                if (value == '\n') {
                    if (fields.size() != 1 || !fields.getFirst().isBlank()) rows.add(new Row(startLine, List.copyOf(fields)));
                    if (rows.size() > MAX_ROWS + 1) throw invalid("В одном CSV может быть до 500 записей.");
                    fields.clear();
                    startLine = ++line;
                }
            } else if (value == '"' && field.isEmpty() && !closed) {
                quoted = true;
            } else if (closed || value == '"') {
                throw invalid("Проверьте кавычки в строке " + line + ".");
            } else {
                field.append(value);
            }
        }
        return rows;
    }

    static ResponseStatusException at(Row row, String message) {
        return invalid("Строка " + row.line() + ": " + message);
    }

    private static ResponseStatusException invalid(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}

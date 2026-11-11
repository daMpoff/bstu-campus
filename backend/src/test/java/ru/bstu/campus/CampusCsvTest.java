package ru.bstu.campus;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.nio.charset.StandardCharsets;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class CampusCsvTest {
    private static final List<String> HEADER = List.of("name", "faculty_code", "study_form");

    @Test
    void acceptsExcelUtf8BomAndSemicolonsWithQuotedFields() {
        var rows = CampusCsv.read(bytes("\ufeffname;faculty_code;study_form\r\n\"О-26;ИВТ \"\"1\"\"\";fit;очная\r\n"), HEADER);
        assertEquals(List.of(new CampusCsv.Row(2, List.of("О-26;ИВТ \"1\"", "fit", "очная"))), rows);
    }

    @Test
    void parsesCommaDelimitedValuesAndReportsPhysicalLines() {
        var rows = CampusCsv.read(bytes("name,faculty_code,study_form\n\"А, Б\nВ\",fit,очная\n\nИВТ-26,fit,заочное"), HEADER);
        assertEquals(List.of(
            new CampusCsv.Row(2, List.of("А, Б\nВ", "fit", "очная")),
            new CampusCsv.Row(5, List.of("ИВТ-26", "fit", "заочное"))), rows);
    }

    @Test
    void rejectsTruncatedQuotedValuesAndUnexpectedColumns() {
        assertThrows(ResponseStatusException.class,
            () -> CampusCsv.read(bytes("name,faculty_code,study_form\n\"ИВТ-26,fit,очная"), HEADER));
        assertThrows(ResponseStatusException.class,
            () -> CampusCsv.read(bytes("name,faculty_code,study_form\nИВТ-26,fit,очная,лишнее"), HEADER));
        assertThrows(ResponseStatusException.class, () -> CampusCsv.read(new byte[] {(byte) 0xc3, (byte) 0x28}, HEADER));
    }

    private static byte[] bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }
}

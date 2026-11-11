package ru.bstu.campus;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.web.server.ResponseStatusException;

class ActivityServiceTest {
    @ParameterizedTest
    @CsvSource({"80,25,20.00", "80,50,40.00", "80,75,60.00", "80,100,80.00", "5,25,1.25"})
    void awardsExactShareOfMaximum(int maximum, int level, BigDecimal points) {
        assertEquals(points, ActivityService.awardPoints(maximum, ActivityService.participationLevel(BigDecimal.valueOf(level))));
    }

    @Test
    void rejectsPercentagesOutsideTheFourExactLevels() {
        assertThrows(ResponseStatusException.class, () -> ActivityService.participationLevel(new BigDecimal("25.5")));
        assertThrows(ResponseStatusException.class, () -> ActivityService.participationLevel(BigDecimal.ZERO));
    }

    @Test
    void budgetMonthChangesAtMidnightInMoscow() {
        assertEquals(LocalDate.of(2026, 11, 1), ActivityService.budgetMonth(Instant.parse("2026-11-30T20:59:59Z")));
        assertEquals(LocalDate.of(2026, 12, 1), ActivityService.budgetMonth(Instant.parse("2026-11-30T21:00:00Z")));
    }
}

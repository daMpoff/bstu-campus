package ru.bstu.campus;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

class SemesterReplenishmentTest {
    private static final LocalDate FEBRUARY = LocalDate.of(2027, 2, 1);

    @Test
    void semesterStartsAtMidnightInMoscow() {
        var days = SemesterReplenishment.parseStartDays("02-01,09-01");
        var earliest = LocalDate.of(2026, 11, 11);

        assertEquals(List.of(), SemesterReplenishment.dueDates(
            days, earliest, Instant.parse("2027-01-31T20:59:59Z"), Set.of()));
        assertEquals(List.of(FEBRUARY), SemesterReplenishment.dueDates(
            days, earliest, Instant.parse("2027-01-31T21:00:00Z"), Set.of()));
    }

    @Test
    void catchesUpMissedSemestersWithoutBackdatingBeforeEligibility() {
        var days = SemesterReplenishment.parseStartDays("09-01, 02-01");
        var earliest = LocalDate.of(2026, 9, 2);

        assertEquals(List.of(FEBRUARY, LocalDate.of(2027, 9, 1)), SemesterReplenishment.dueDates(
            days, earliest, Instant.parse("2027-09-04T10:00:00Z"), Set.of()));
    }

    @Test
    void reschedulingAnAlreadyAppliedTermDoesNotCreditItAgain() {
        var days = SemesterReplenishment.parseStartDays("02-15,09-01");
        var applied = Set.of(SemesterReplenishment.Term.of(FEBRUARY));

        assertEquals(List.of(LocalDate.of(2027, 9, 1)), SemesterReplenishment.dueDates(
            days, LocalDate.of(2027, 1, 1), Instant.parse("2027-09-02T10:00:00Z"), applied));
    }

    @Test
    void rejectsInvalidOrAmbiguousAnnualDates() {
        assertThrows(IllegalArgumentException.class, () -> SemesterReplenishment.parseStartDays("02-30,09-01"));
        assertThrows(IllegalArgumentException.class, () -> SemesterReplenishment.parseStartDays("02-29,09-01"));
        assertThrows(IllegalArgumentException.class, () -> SemesterReplenishment.parseStartDays("02-01,03-01"));
    }
}

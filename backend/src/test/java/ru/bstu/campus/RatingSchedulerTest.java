package ru.bstu.campus;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Duration;
import java.time.Instant;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class RatingSchedulerTest {
    private static final Instant NEXT_PENALTY = Instant.parse("2026-11-11T10:01:00Z");
    private static final Duration INTERVAL = Duration.ofMinutes(1);

    @ParameterizedTest
    @CsvSource({"20,1000,100,0,20", "20,920,100,95,5", "20,9,100,0,9", "20,0,100,0,0", "20,900,100,100,0"})
    void respectsStepRatingAndAssignmentLimit(int step, int rating, int limit, int deducted, int expected) {
        assertEquals(expected, RatingScheduler.scheduledCharge(step, rating, limit, deducted,
            NEXT_PENALTY, NEXT_PENALTY, INTERVAL).amount());
    }

    @Test
    void catchesUpAllMissedMinutesAndKeepsTheOriginalSchedule() {
        var charge = RatingScheduler.scheduledCharge(20, 1000, 500, 0,
            NEXT_PENALTY, NEXT_PENALTY.plusSeconds(9 * 60 + 30), INTERVAL);

        assertEquals(200, charge.amount());
        assertEquals(NEXT_PENALTY.plusSeconds(10 * 60), charge.nextPenaltyAt());
    }

    @Test
    void chargesExactlyAtTheDueInstantAndNeverBeforeIt() {
        assertEquals(new RatingScheduler.Charge(0, NEXT_PENALTY), RatingScheduler.scheduledCharge(
            20, 1000, 100, 0, NEXT_PENALTY, NEXT_PENALTY.minusNanos(1), INTERVAL));
        assertEquals(new RatingScheduler.Charge(20, NEXT_PENALTY.plus(INTERVAL)), RatingScheduler.scheduledCharge(
            20, 1000, 100, 0, NEXT_PENALTY, NEXT_PENALTY, INTERVAL));
    }

    @ParameterizedTest
    @CsvSource({"1000,45,20,25", "9,100,0,9", "0,100,0,0", "1000,100,100,0"})
    void catchUpRespectsTheRemainingLimitAndBalance(int rating, int limit, int deducted, int expected) {
        var charge = RatingScheduler.scheduledCharge(20, rating, limit, deducted,
            NEXT_PENALTY, NEXT_PENALTY.plus(Duration.ofDays(1)), INTERVAL);

        assertEquals(expected, charge.amount());
    }

    @Test
    void returnedWorkUsesItsNewDueInstantWithoutChargingTimeSpentInReview() {
        Instant returnedAt = NEXT_PENALTY.plus(Duration.ofDays(2));
        Instant resumedAt = returnedAt.plus(INTERVAL);

        assertEquals(new RatingScheduler.Charge(0, resumedAt), RatingScheduler.scheduledCharge(
            20, 900, 100, 40, resumedAt, returnedAt.plusSeconds(59), INTERVAL));
        assertEquals(new RatingScheduler.Charge(20, resumedAt.plus(INTERVAL)), RatingScheduler.scheduledCharge(
            20, 900, 100, 40, resumedAt, resumedAt, INTERVAL));
    }
}

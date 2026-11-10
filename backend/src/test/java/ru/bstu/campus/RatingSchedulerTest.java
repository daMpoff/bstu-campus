package ru.bstu.campus;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class RatingSchedulerTest {
    @ParameterizedTest
    @CsvSource({"20,1000,100,0,20", "20,920,100,95,5", "20,9,100,0,9", "20,0,100,0,0", "20,900,100,100,0"})
    void respectsStepRatingAndAssignmentLimit(int step, int rating, int limit, int deducted, int expected) {
        assertEquals(expected, RatingScheduler.deduction(step, rating, limit, deducted));
    }
}

package ru.bstu.campus;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.Duration;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class CampusSettingsTest {
    @Test
    void sortsSemestersAndAllowsDisablingCreditAndBudget() {
        var settings = CampusSettings.validate(new CampusSettings.Update(20, 60, 0, "09-01, 02-01", 0));
        assertEquals(new CampusSettings.Values(20, 60, 0, "02-01,09-01", 0), settings);
        assertEquals(Duration.ofMinutes(1), settings.penaltyInterval());
    }

    @Test
    void rejectsBadSemesterDatesAndOutOfRangeSettings() {
        assertThrows(ResponseStatusException.class, () -> CampusSettings.validate(new CampusSettings.Update(20, 0, 200, "02-01,09-01", 1000)));
        assertThrows(ResponseStatusException.class, () -> CampusSettings.validate(new CampusSettings.Update(20, 60, 200, "03-01,02-01", 1000)));
        assertThrows(ResponseStatusException.class, () -> CampusSettings.validate(new CampusSettings.Update(20, 60, 200, "02-01,09-01", -1)));
    }
}

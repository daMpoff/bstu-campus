package ru.bstu.campus;

import java.security.Principal;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
class AnalyticsController {
    private final AssignmentService accounts;
    private final AnalyticsService analytics;

    AnalyticsController(AssignmentService accounts, AnalyticsService analytics) {
        this.accounts = accounts;
        this.analytics = analytics;
    }

    @GetMapping("/api/teacher/analytics")
    AnalyticsService.Report report(Principal principal, @RequestParam long groupId,
                                   @RequestParam(defaultValue = "6") int months) {
        return analytics.report(accounts.account(principal.getName()).id(), groupId, months);
    }
}

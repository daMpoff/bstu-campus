package ru.bstu.campus;

import java.math.BigDecimal;
import java.security.Principal;
import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
class ActivityController {
    private final ActivityService activities;
    private final AssignmentService accounts;

    ActivityController(ActivityService activities, AssignmentService accounts) {
        this.activities = activities;
        this.accounts = accounts;
    }

    record Created(long id) {}
    record Confirmation(long studentId, BigDecimal participation) {}

    @GetMapping("/teacher/activities")
    List<ActivityService.Activity> teaching(Principal principal) {
        return activities.teaching(userId(principal));
    }

    @PostMapping("/teacher/activities")
    @ResponseStatus(HttpStatus.CREATED)
    Created create(Principal principal, @RequestBody ActivityService.NewActivity input) {
        return new Created(activities.create(userId(principal), input));
    }

    @GetMapping("/teacher/activities/{id}")
    ActivityService.Detail detail(Principal principal, @PathVariable long id) {
        return activities.detail(userId(principal), id);
    }

    @PostMapping("/teacher/activities/{id}/confirm")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void confirm(Principal principal, @PathVariable long id, @RequestBody Confirmation input) {
        activities.confirm(userId(principal), id, input.studentId(), input.participation());
    }

    @GetMapping("/student/activities")
    List<ActivityService.StudentActivity> studying(Principal principal) {
        return activities.studying(userId(principal));
    }

    @PostMapping("/student/activities/{id}/enroll")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void enroll(Principal principal, @PathVariable long id) {
        activities.enroll(userId(principal), id);
    }

    @GetMapping("/rewards")
    ActivityService.RewardPage rewards(@RequestParam(required = false) Long beforeId) {
        return activities.rewards(beforeId);
    }

    private long userId(Principal principal) {
        return accounts.account(principal.getName()).id();
    }
}

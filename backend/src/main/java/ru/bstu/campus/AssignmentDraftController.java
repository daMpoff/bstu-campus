package ru.bstu.campus;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/teacher/assignment-drafts")
class AssignmentDraftController {
    private final AssignmentDraftService drafts;

    AssignmentDraftController(AssignmentDraftService drafts) {
        this.drafts = drafts;
    }

    record Availability(boolean available) {}
    record DraftInput(String notes) {}

    @GetMapping("/status")
    Availability status() {
        return new Availability(drafts.available());
    }

    @PostMapping
    AssignmentDraftService.Draft generate(@RequestBody DraftInput input) {
        return drafts.generate(input.notes());
    }
}

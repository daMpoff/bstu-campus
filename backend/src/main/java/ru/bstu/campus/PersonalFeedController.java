package ru.bstu.campus;

import java.security.Principal;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
class PersonalFeedController {
    private final PersonalFeedService feed;
    private final AssignmentService accounts;

    PersonalFeedController(PersonalFeedService feed, AssignmentService accounts) {
        this.feed = feed;
        this.accounts = accounts;
    }

    @GetMapping("/api/feed")
    PersonalFeedService.Page personalFeed(Principal user, @RequestParam(required = false) Long beforeId) {
        return feed.page(accounts.account(user.getName()).id(), beforeId);
    }
}

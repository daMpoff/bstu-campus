package ru.bstu.campus;

import java.security.Principal;
import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
class PollController {
    private final PollService polls;
    private final AssignmentService accounts;

    PollController(PollService polls, AssignmentService accounts) {
        this.polls = polls;
        this.accounts = accounts;
    }

    record Created(long id) {}

    @GetMapping("/teacher/polls")
    List<PollService.Summary> teacherPolls(Principal user) {
        return polls.list(account(user), true);
    }

    @PostMapping("/teacher/polls")
    @ResponseStatus(HttpStatus.CREATED)
    Created create(Principal user, @RequestBody PollService.NewPoll input) {
        return new Created(polls.create(account(user), input));
    }

    @GetMapping("/teacher/polls/{id}")
    PollService.Detail teacherPoll(Principal user, @PathVariable long id) {
        return polls.detail(account(user), id, true);
    }

    @GetMapping("/student/polls")
    List<PollService.Summary> studentPolls(Principal user) {
        return polls.list(account(user), false);
    }

    @GetMapping("/student/polls/{id}")
    PollService.Detail studentPoll(Principal user, @PathVariable long id) {
        return polls.detail(account(user), id, false);
    }

    @PostMapping("/student/polls/{id}/vote")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void vote(Principal user, @PathVariable long id, @RequestBody PollService.Vote input) {
        polls.vote(account(user), id, input);
    }

    private long account(Principal user) {
        return accounts.account(user.getName()).id();
    }
}

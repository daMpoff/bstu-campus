package ru.bstu.campus;

import java.security.Principal;
import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/teacher/groups/{groupId}/pending-students")
class GroupApprovalController {
    private final RegistrationConfirmation confirmation;
    private final AssignmentService accounts;

    GroupApprovalController(RegistrationConfirmation confirmation, AssignmentService accounts) {
        this.confirmation = confirmation;
        this.accounts = accounts;
    }

    @GetMapping
    List<RegistrationConfirmation.PendingStudent> pending(@PathVariable long groupId) {
        return confirmation.pending(groupId);
    }

    @PostMapping("/{studentId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void approve(Principal principal, @PathVariable long groupId, @PathVariable long studentId) {
        confirmation.approveGroup(accounts.account(principal.getName()).id(), groupId, studentId);
    }
}

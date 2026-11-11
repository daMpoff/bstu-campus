package ru.bstu.campus;

import java.security.Principal;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/api/teacher", "/api/admin", "/api/student"})
class GroupApprovalController {
    private final RegistrationConfirmation confirmation;
    private final GroupLeadership leadership;
    private final AssignmentService accounts;

    GroupApprovalController(RegistrationConfirmation confirmation, GroupLeadership leadership, AssignmentService accounts) {
        this.confirmation = confirmation;
        this.leadership = leadership;
        this.accounts = accounts;
    }

    record Leader(@JsonProperty(value = "studentId", required = true) Long studentId) {}
    record ResponsibleTeachers(List<Long> teacherIds) {}

    @GetMapping("/group-approval/groups")
    List<GroupLeadership.ApprovalGroup> groups(Principal principal) {
        return leadership.groups(accounts.account(principal.getName()));
    }

    @GetMapping("/groups/{groupId}/pending-students")
    List<GroupLeadership.Member> pending(Principal principal, @PathVariable long groupId) {
        return leadership.pending(accounts.account(principal.getName()), groupId);
    }

    @PostMapping("/groups/{groupId}/pending-students/{studentId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void approve(Principal principal, @PathVariable long groupId, @PathVariable long studentId) {
        confirmation.approveGroup(accounts.account(principal.getName()), groupId, studentId);
    }

    @GetMapping("/groups/{groupId}/leadership")
    GroupLeadership.Leadership leadership(Principal principal, @PathVariable long groupId) {
        return leadership.leadership(accounts.account(principal.getName()), groupId);
    }

    @PutMapping("/groups/{groupId}/leader")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void setLeader(Principal principal, @PathVariable long groupId, @RequestBody Leader leader) {
        leadership.setLeader(accounts.account(principal.getName()), groupId, leader.studentId());
    }

    @PutMapping("/groups/{groupId}/responsible-teachers")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void setResponsibleTeachers(Principal principal, @PathVariable long groupId, @RequestBody ResponsibleTeachers teachers) {
        leadership.setResponsibleTeachers(accounts.account(principal.getName()), groupId, teachers.teacherIds());
    }
}

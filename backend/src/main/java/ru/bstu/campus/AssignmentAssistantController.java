package ru.bstu.campus;

import java.io.IOException;
import java.security.Principal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api")
class AssignmentAssistantController {
    private final AssignmentService assignments;
    private final AssignmentAssistantService assistant;

    AssignmentAssistantController(AssignmentService assignments, AssignmentAssistantService assistant) {
        this.assignments = assignments;
        this.assistant = assistant;
    }

    @GetMapping("/assistant/recipients")
    List<AssignmentAssistantService.Recipient> recipients(Principal principal, @RequestParam(defaultValue = "") String q) {
        return assistant.recipients(actor(principal), q);
    }

    @GetMapping("/assistant/recipients/{id}/assignments")
    List<AssignmentAssistantService.Target> targets(Principal principal, @PathVariable long id) {
        return assistant.targets(actor(principal), id);
    }

    @PostMapping(value = "/assistant/transfers", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    AssignmentAssistantService.Receipt transfer(Principal principal, @RequestParam long recipientId,
                                                @RequestParam long assignmentId, @RequestParam MultipartFile file)
            throws IOException {
        return assistant.transfer(actor(principal), recipientId, assignmentId, AssignmentUpload.read(file));
    }

    @PostMapping(value = "/assistant/assignments", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    AssignmentAssistantService.Receipt publish(Principal principal, @RequestParam UUID requestId,
                                               @RequestParam long recipientId, @RequestParam String title,
                                               @RequestParam String description, @RequestParam Instant deadline,
                                               @RequestParam Integer penaltyLimit,
                                               @RequestParam(required = false) MultipartFile file) throws IOException {
        return assistant.publish(actor(principal), requestId, recipientId, title, description, deadline, penaltyLimit,
            AssignmentUpload.read(file));
    }

    @GetMapping("/assignments/{id}/materials")
    List<AssignmentAssistantService.Material> materials(Principal principal, @PathVariable long id) {
        return assistant.materials(actor(principal), id);
    }

    @GetMapping("/assignment-materials/{id}/download")
    ResponseEntity<byte[]> download(Principal principal, @PathVariable long id) {
        return AssignmentController.download(assistant.material(actor(principal), id));
    }

    @GetMapping("/assignment-materials/{id}/preview")
    ResponseEntity<byte[]> preview(Principal principal, @PathVariable long id) {
        return AssignmentController.preview(assistant.material(actor(principal), id));
    }

    private AssignmentService.Account actor(Principal principal) {
        return assignments.account(principal.getName());
    }
}

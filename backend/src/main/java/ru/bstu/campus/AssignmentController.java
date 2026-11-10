package ru.bstu.campus;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.Principal;
import java.time.Instant;
import java.util.List;

import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
class AssignmentController {
    private final AssignmentService service;

    AssignmentController(AssignmentService service) {
        this.service = service;
    }

    @GetMapping("/me")
    AssignmentService.Account me(Principal principal) {
        return service.account(principal.getName());
    }

    @GetMapping("/teacher/groups")
    List<AssignmentService.Group> groups() {
        return service.groups();
    }

    @GetMapping("/teacher/assignments")
    List<AssignmentService.Assignment> teaching(Principal principal) {
        return service.teaching(me(principal).id());
    }

    record NewAssignment(String title, String description, List<Long> groupIds, Instant deadline, Integer penaltyLimit) {}
    record Created(long id) {}
    record Review(List<Long> studentIds, String action) {}

    @PostMapping("/teacher/assignments")
    @ResponseStatus(HttpStatus.CREATED)
    Created create(Principal principal, @RequestBody NewAssignment body) {
        return new Created(service.create(me(principal).id(), body));
    }

    @GetMapping("/teacher/assignments/{id}/works")
    List<AssignmentService.Work> works(Principal principal, @PathVariable long id) {
        return service.works(me(principal).id(), id);
    }

    @PostMapping("/teacher/assignments/{id}/review")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void review(Principal principal, @PathVariable long id, @RequestBody Review body) {
        service.review(me(principal).id(), id, body);
    }

    @GetMapping("/student/assignments")
    List<AssignmentService.StudentAssignment> studying(Principal principal) {
        return service.studying(me(principal).id());
    }

    @PostMapping(value = "/student/assignments/{id}/submit", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void submit(Principal principal, @PathVariable long id,
                @RequestParam(required = false) String link,
                @RequestParam(required = false) MultipartFile file) throws IOException {
        String workLink = link == null || link.isBlank() ? null : link.trim();
        if (workLink != null) {
            try {
                URI url = URI.create(workLink);
                if (workLink.length() > 2048 || url.getHost() == null
                    || !("https".equalsIgnoreCase(url.getScheme()) || "http".equalsIgnoreCase(url.getScheme()))) {
                    throw new IllegalArgumentException();
                }
            } catch (IllegalArgumentException error) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Укажите корректную ссылку http или https.");
            }
        }
        boolean hasFile = file != null && !file.isEmpty();
        if (workLink == null && !hasFile) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Приложите ссылку или файл.");
        }
        String fileName = hasFile ? file.getOriginalFilename() : null;
        if (hasFile) {
            fileName = fileName == null ? "work" : fileName.replace('\\', '/');
            fileName = fileName.substring(fileName.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}]", "").strip();
            if (fileName.isEmpty() || fileName.length() > 180) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Укажите имя файла длиной до 180 символов.");
            }
        }
        service.submit(me(principal).id(), id, workLink, fileName, hasFile ? file.getBytes() : null);
    }

    @GetMapping("/works/{id}/files/{studentId}")
    ResponseEntity<byte[]> download(Principal principal, @PathVariable long id, @PathVariable long studentId) {
        var file = service.attachment(me(principal), id, studentId);
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM)
            .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                .filename(file.name(), StandardCharsets.UTF_8).build().toString())
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .body(file.content());
    }
}

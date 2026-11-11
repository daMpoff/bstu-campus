package ru.bstu.campus;

import java.security.Principal;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/student/ranking")
class StudentRankingController {
    private final StudentRankingService service;

    StudentRankingController(StudentRankingService service) {
        this.service = service;
    }

    @GetMapping
    StudentRankingService.Ranking ranking(Principal principal,
                                          @RequestParam(defaultValue = "AR") StudentRankingService.Metric metric,
                                          @RequestParam(required = false) Long facultyId,
                                          @RequestParam(required = false) Long groupId,
                                          @RequestParam(defaultValue = "1") int page) {
        return service.ranking(principal.getName(), metric, facultyId, groupId, page);
    }

    @GetMapping("/catalog")
    StudentRankingService.Catalog catalog() {
        return service.catalog();
    }
}

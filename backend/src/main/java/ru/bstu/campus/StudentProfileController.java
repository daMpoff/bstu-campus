package ru.bstu.campus;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
class StudentProfileController {
    private final StudentProfileService profiles;

    StudentProfileController(StudentProfileService profiles) {
        this.profiles = profiles;
    }

    @GetMapping("/api/profiles/{id}")
    StudentProfileService.Profile profile(@PathVariable long id) {
        return profiles.profile(id);
    }
}

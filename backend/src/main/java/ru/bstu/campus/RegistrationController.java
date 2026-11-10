package ru.bstu.campus;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/registration")
class RegistrationController {
    private final RegistrationService service;

    RegistrationController(RegistrationService service) {
        this.service = service;
    }

    @GetMapping("/catalog")
    RegistrationService.Catalog catalog() {
        return service.catalog();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void register(@RequestBody RegistrationService.SignUp input) {
        service.register(input);
    }
}

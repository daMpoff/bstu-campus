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
    private final RegistrationConfirmation confirmation;

    RegistrationController(RegistrationService service, RegistrationConfirmation confirmation) {
        this.service = service;
        this.confirmation = confirmation;
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

    record Verification(String token) {}
    record Resend(String email) {}

    @PostMapping("/confirm-email")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void confirmEmail(@RequestBody Verification input) {
        confirmation.confirmEmail(input.token());
    }

    @PostMapping("/resend-email")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void resendEmail(@RequestBody Resend input) {
        confirmation.resend(input.email());
    }
}

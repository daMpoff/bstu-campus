package ru.bstu.campus;

import java.util.Set;
import java.util.stream.Collectors;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/assistant")
class AssistantHelpController {
    private final AssistantHelpService help;

    AssistantHelpController(AssistantHelpService help) {
        this.help = help;
    }

    record Question(String question) {}

    @PostMapping("/ask")
    AssistantHelpService.Answer ask(Authentication authentication, @RequestBody Question input) {
        Set<String> roles = authentication.getAuthorities().stream()
            .map(GrantedAuthority::getAuthority)
            .collect(Collectors.toUnmodifiableSet());
        return help.ask(input.question(), roles);
    }
}

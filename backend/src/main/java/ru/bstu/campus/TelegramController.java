package ru.bstu.campus;

import java.security.Principal;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/telegram")
class TelegramController {
    private final TelegramLinkService links;
    private final AssignmentService accounts;

    TelegramController(TelegramLinkService links, AssignmentService accounts) {
        this.links = links;
        this.accounts = accounts;
    }

    @GetMapping
    ResponseEntity<TelegramLinkService.Status> status(Principal principal) {
        return noCache(links.status(account(principal)));
    }

    @PostMapping("/code")
    ResponseEntity<TelegramLinkService.PairingCode> issue(Principal principal) {
        return noCache(links.issue(account(principal)));
    }

    @DeleteMapping
    ResponseEntity<TelegramLinkService.Status> disconnect(Principal principal) {
        return noCache(links.disconnect(account(principal)));
    }

    private long account(Principal principal) {
        return accounts.account(principal.getName()).id();
    }

    private static <T> ResponseEntity<T> noCache(T body) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
    }
}

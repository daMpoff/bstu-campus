package ru.bstu.campus;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
class DemoAccess {
    static final String ADMIN_EMAIL = "admin@bgtu.test";

    private final boolean enabled;
    private final boolean adminEnabled;

    DemoAccess(@Value("${campus.demo}") boolean enabled, @Value("${campus.demo-admin}") boolean adminEnabled) {
        this.enabled = enabled;
        this.adminEnabled = enabled && adminEnabled;
    }

    boolean enabled() { return enabled; }

    boolean adminEnabled() { return adminEnabled; }

    boolean allowsLogin(String email) {
        return switch (email) {
            case ADMIN_EMAIL -> adminEnabled;
            case "teacher@bgtu.test", "student@bgtu.test", "student2@bgtu.test", "student3@bgtu.test" -> enabled;
            default -> true;
        };
    }
}

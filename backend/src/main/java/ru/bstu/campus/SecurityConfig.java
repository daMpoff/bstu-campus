package ru.bstu.campus;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ResponseBody;

@Configuration
class SecurityConfig {
    @Bean
    SecurityFilterChain security(HttpSecurity http) throws Exception {
        return http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/csrf", "/api/login").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/registration/catalog", "/api/demo", "/api/demo/accounts").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/registration", "/api/registration/confirm-email",
                    "/api/registration/resend-email").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .requestMatchers("/api/teacher/**").hasRole("TEACHER")
                .requestMatchers("/api/student/**").hasRole("STUDENT")
                .requestMatchers("/api/**").authenticated()
                .anyRequest().permitAll())
            .requestCache(cache -> cache.disable())
            .exceptionHandling(errors -> errors.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
            .formLogin(login -> login.loginPage("/login").loginProcessingUrl("/api/login")
                .usernameParameter("email")
                .successHandler((request, response, user) -> response.setStatus(204))
                .failureHandler((request, response, failure) -> response.setStatus(401)))
            .logout(logout -> logout.logoutUrl("/api/logout")
                .logoutSuccessHandler((request, response, user) -> response.setStatus(204)))
            .build();
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    UserDetailsService users(JdbcClient db, DemoAccess demoAccess) {
        return email -> db.sql("SELECT email, password_hash, role, email_verified FROM campus_user WHERE email = :email")
            .param("email", email.trim().toLowerCase(java.util.Locale.ROOT))
            .query((row, index) -> User.withUsername(row.getString("email"))
                .password(row.getString("password_hash")).roles(row.getString("role"))
                .disabled(!row.getBoolean("email_verified") || !demoAccess.allowsLogin(row.getString("email"))).build())
            .optional().orElseThrow(() -> new UsernameNotFoundException("Пользователь не найден"));
    }

}

@Controller
class PageController {
    private final DemoAccess demoAccess;

    PageController(DemoAccess demoAccess) {
        this.demoAccess = demoAccess;
    }

    @GetMapping({"/login", "/register", "/confirm-email", "/assignments", "/assignments/new", "/assignments/{id:[0-9]+}",
                 "/review", "/rating", "/profile", "/profiles/{id:[0-9]+}",
                 "/activities", "/activities/new", "/activities/{id:[0-9]+}", "/rewards", "/group-approval",
                 "/polls", "/polls/new", "/polls/{id:[0-9]+}", "/feed", "/analytics", "/admin", "/settings"})
    String page() {
        return "forward:/index.html";
    }

    @ResponseBody
    @GetMapping("/api/csrf")
    CsrfToken csrf(CsrfToken token) {
        return token;
    }

    @ResponseBody
    @GetMapping("/api/demo")
    boolean demo() {
        return demoAccess.enabled();
    }

    record DemoAccounts(boolean enabled, boolean admin) {}

    @ResponseBody
    @GetMapping("/api/demo/accounts")
    DemoAccounts demoAccounts() {
        return new DemoAccounts(demoAccess.enabled(), demoAccess.adminEnabled());
    }
}

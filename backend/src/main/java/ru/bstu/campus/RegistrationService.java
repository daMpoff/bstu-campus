package ru.bstu.campus;

import java.nio.charset.StandardCharsets;
import java.sql.Types;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
class RegistrationService {
    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");

    private final JdbcClient db;
    private final PasswordEncoder passwords;
    private final RegistrationConfirmation confirmation;

    RegistrationService(JdbcClient db, PasswordEncoder passwords, RegistrationConfirmation confirmation) {
        this.db = db;
        this.passwords = passwords;
        this.confirmation = confirmation;
    }

    record Faculty(long id, String name) {}
    record Department(long id, String name, String facultyName) {}
    record Group(long id, String name, String studyForm, long facultyId) {}
    record Catalog(List<Faculty> faculties, List<Department> departments, List<Group> groups) {}
    record SignUp(String email, String password, String fullName, String role,
                  Long facultyId, Long groupId, Long departmentId) {}

    Catalog catalog() {
        var faculties = db.sql("SELECT id, name FROM faculty ORDER BY name").query(Faculty.class).list();
        var departments = db.sql("""
            SELECT d.id, d.name, f.name AS faculty_name
            FROM department d JOIN faculty f ON f.id = d.faculty_id ORDER BY f.name, d.name
            """).query(Department.class).list();
        var groups = db.sql("""
            SELECT id, name, study_form, faculty_id
            FROM study_group WHERE study_form IS NOT NULL ORDER BY name
            """).query(Group.class).list();
        return new Catalog(faculties, departments, groups);
    }

    @Transactional
    void register(SignUp input) {
        String email = input.email() == null ? "" : input.email().strip().toLowerCase(Locale.ROOT);
        String fullName = input.fullName() == null ? "" : input.fullName().strip();
        String password = input.password();
        if (email.length() > 254 || !EMAIL.matcher(email).matches()) {
            throw badRequest("Укажите корректный email.");
        }
        if (fullName.length() < 2 || fullName.length() > 160) {
            throw badRequest("Укажите ФИО длиной от 2 до 160 символов.");
        }
        if (password == null || password.isBlank() || password.length() < 8
                || password.getBytes(StandardCharsets.UTF_8).length > 72) {
            throw badRequest("Пароль должен содержать от 8 символов и занимать не больше 72 байт.");
        }
        boolean student = "STUDENT".equals(input.role());
        if (!student && !"TEACHER".equals(input.role())) {
            throw badRequest("Выберите роль.");
        }

        if (student) {
            validateStudent(input);
        } else {
            validateTeacher(input);
        }
        long user = db.sql("""
            INSERT INTO campus_user(email, password_hash, full_name, role, group_id, faculty_id, department_id, group_verified)
            VALUES (:email, :password, :name, :role, :groupId, :faculty, :department, :teacher)
            ON CONFLICT (email) DO NOTHING RETURNING id
            """).param("email", email).param("password", passwords.encode(password)).param("name", fullName)
            .param("role", input.role()).param("groupId", input.groupId(), Types.BIGINT)
            .param("faculty", input.facultyId(), Types.BIGINT).param("department", input.departmentId(), Types.BIGINT)
            .param("teacher", !student)
            .query(Long.class).optional()
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT, "Этот email уже зарегистрирован."));
        confirmation.issue(user, email);
    }

    private void validateStudent(SignUp input) {
        if (input.facultyId() == null || input.groupId() == null || input.departmentId() != null) {
            throw badRequest("Выберите факультет и учебную группу.");
        }
        if (db.sql("""
            SELECT id FROM study_group
            WHERE id = :groupId AND faculty_id = :facultyId AND study_form IS NOT NULL
            FOR UPDATE
            """).param("groupId", input.groupId()).param("facultyId", input.facultyId())
                .query(Long.class).optional().isEmpty()) {
            throw badRequest("Выберите учебную группу выбранного факультета или института.");
        }
    }

    private void validateTeacher(SignUp input) {
        if (input.departmentId() == null || input.facultyId() != null || input.groupId() != null
                || db.sql("SELECT id FROM department WHERE id = :id").param("id", input.departmentId())
                    .query(Long.class).optional().isEmpty()) {
            throw badRequest("Выберите кафедру из списка.");
        }
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}

package ru.bstu.campus;

import java.nio.charset.StandardCharsets;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
class AdminService {
    private static final Set<String> STUDY_FORMS = Set.of("очная", "очно-заочное", "заочное");
    private static final Pattern CODE = Pattern.compile("[a-z0-9][a-z0-9_-]{0,39}");
    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");

    enum Kind {
        FACULTIES("faculty"), DEPARTMENTS("department"), GROUPS("study_group");

        final String table;
        Kind(String table) { this.table = table; }

        static Kind fromPath(String path) {
            try {
                return valueOf(path.toUpperCase(Locale.ROOT));
            } catch (IllegalArgumentException unknown) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Справочник не найден.");
            }
        }
    }

    record Faculty(long id, String code, String name) {}
    record Department(long id, String code, String name, long facultyId) {}
    record Group(long id, String name, String studyForm, Long facultyId) {}
    record Catalog(List<Faculty> faculties, List<Department> departments, List<Group> groups) {}
    record Entry(String code, String name, Long facultyId, String studyForm) {}
    record Imported(int imported) {}

    private record GroupImport(CampusCsv.Row row, String name, String facultyCode, String studyForm) {}
    private record StudentImport(CampusCsv.Row row, String email, String fullName, String groupName, String passwordHash) {}

    private final JdbcClient db;
    private final PasswordEncoder passwords;
    private final RegistrationConfirmation confirmation;

    AdminService(JdbcClient db, PasswordEncoder passwords, RegistrationConfirmation confirmation) {
        this.db = db;
        this.passwords = passwords;
        this.confirmation = confirmation;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    Catalog catalog() {
        return new Catalog(
            db.sql("SELECT id, code, name FROM faculty ORDER BY name, id").query(Faculty.class).list(),
            db.sql("SELECT id, code, name, faculty_id FROM department ORDER BY name, id").query(Department.class).list(),
            db.sql("SELECT id, name, study_form, faculty_id FROM study_group ORDER BY name, id").query(Group.class).list());
    }

    @Transactional
    long create(Kind kind, Entry input) {
        String name = validName(input.name(), "Укажите название длиной от 2 до 160 символов.");
        try {
            return switch (kind) {
                case FACULTIES -> db.sql("INSERT INTO faculty(code, name) VALUES (:code, :name) RETURNING id")
                    .param("code", validCode(input.code())).param("name", name).query(Long.class).single();
                case DEPARTMENTS -> db.sql("INSERT INTO department(code, name, faculty_id) VALUES (:code, :name, :faculty) RETURNING id")
                    .param("code", validCode(input.code())).param("name", name)
                    .param("faculty", requireFaculty(input.facultyId())).query(Long.class).single();
                case GROUPS -> addGroup(name, requireFaculty(input.facultyId()), validStudyForm(input.studyForm()));
            };
        } catch (DataIntegrityViolationException conflict) {
            throw conflict("Запись с таким кодом или названием уже существует, либо подразделение изменилось.");
        }
    }

    @Transactional
    void update(Kind kind, long id, Entry input) {
        String name = validName(input.name(), "Укажите название длиной от 2 до 160 символов.");
        try {
            int updated = switch (kind) {
                case FACULTIES -> db.sql("UPDATE faculty SET name = :name WHERE id = :id")
                    .param("name", name).param("id", id).update();
                case DEPARTMENTS -> db.sql("UPDATE department SET name = :name, faculty_id = :faculty WHERE id = :id")
                    .param("name", name).param("id", id).param("faculty", requireFaculty(input.facultyId())).update();
                case GROUPS -> updateGroup(id, name, requireFaculty(input.facultyId()), validStudyForm(input.studyForm()));
            };
            if (updated == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Запись не найдена.");
        } catch (DataIntegrityViolationException conflict) {
            throw conflict("Запись с таким названием уже существует, либо подразделение изменилось.");
        }
    }

    @Transactional
    void delete(Kind kind, long id) {
        try {
            if (db.sql("DELETE FROM " + kind.table + " WHERE id = :id").param("id", id).update() == 0) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Запись не найдена.");
            }
        } catch (DataIntegrityViolationException referenced) {
            throw conflict("Эта запись используется в других справочниках, аккаунтах, заданиях или активностях.");
        }
    }

    @Transactional
    Imported importGroups(byte[] bytes) {
        List<CampusCsv.Row> rows = CampusCsv.read(bytes, List.of("name", "faculty_code", "study_form"));
        var faculties = db.sql("SELECT id, code, name FROM faculty").query(Faculty.class).list().stream()
            .collect(Collectors.toMap(Faculty::code, Faculty::id));
        Set<String> names = new HashSet<>();
        List<GroupImport> groups = rows.stream().map(row -> new GroupImport(row, row.fields().get(0).strip(),
            row.fields().get(1).strip().toLowerCase(Locale.ROOT), row.fields().get(2).strip())).toList();
        for (GroupImport group : groups) {
            if (!isValidName(group.name())) throw CampusCsv.at(group.row(), "укажите название группы до 160 символов.");
            if (!names.add(group.name())) throw CampusCsv.at(group.row(), "название группы повторяется в файле.");
            if (!faculties.containsKey(group.facultyCode())) throw CampusCsv.at(group.row(), "код подразделения не найден.");
            if (!STUDY_FORMS.contains(group.studyForm())) throw CampusCsv.at(group.row(), "укажите форму обучения из справочника.");
        }
        for (GroupImport group : groups.stream().sorted(Comparator.comparing(GroupImport::name)).toList()) {
            try {
                addGroup(group.name(), faculties.get(group.facultyCode()), group.studyForm());
            } catch (DataIntegrityViolationException conflict) {
                throw conflict("Строка " + group.row().line() + ": группа уже существует или подразделение изменилось.");
            }
        }
        return new Imported(groups.size());
    }

    @Transactional
    Imported importStudents(byte[] bytes) {
        List<CampusCsv.Row> rows = CampusCsv.read(bytes, List.of("email", "full_name", "group_name", "password"));
        Set<String> emails = new HashSet<>();
        List<StudentImport> students = rows.stream().map(row -> readStudent(row, emails)).toList();
        List<String> groupNames = students.stream().map(StudentImport::groupName).distinct().toList();
        var groups = db.sql("""
            SELECT id, name, study_form, faculty_id FROM study_group
            WHERE name IN (:groups) AND faculty_id IS NOT NULL ORDER BY id FOR UPDATE
            """).param("groups", groupNames).query(Group.class).list().stream()
            .collect(Collectors.toMap(Group::name, group -> group));
        for (StudentImport student : students.stream().sorted(Comparator.comparing(StudentImport::email)).toList()) {
            Group group = groups.get(student.groupName());
            if (group == null) throw CampusCsv.at(student.row(), "группа с указанным названием не найдена.");
            long id = db.sql("""
                INSERT INTO campus_user(email, password_hash, full_name, role, group_id, faculty_id, email_verified, group_verified)
                VALUES (:email, :hash, :name, 'STUDENT', :group, :faculty, false, true)
                ON CONFLICT (email) DO NOTHING RETURNING id
                """).param("email", student.email()).param("hash", student.passwordHash()).param("name", student.fullName())
                .param("group", group.id()).param("faculty", group.facultyId()).query(Long.class).optional()
                .orElseThrow(() -> conflict("Строка " + student.row().line() + ": email уже зарегистрирован."));
            confirmation.issue(id, student.email());
        }
        return new Imported(students.size());
    }

    private StudentImport readStudent(CampusCsv.Row row, Set<String> emails) {
        String email = row.fields().get(0).strip().toLowerCase(Locale.ROOT);
        String fullName = row.fields().get(1).strip();
        String group = row.fields().get(2).strip();
        String password = row.fields().get(3);
        if (email.length() > 254 || email.chars().anyMatch(Character::isISOControl) || !EMAIL.matcher(email).matches()) {
            throw CampusCsv.at(row, "укажите корректный email.");
        }
        if (!emails.add(email)) throw CampusCsv.at(row, "email повторяется в файле.");
        if (!isValidName(fullName)) throw CampusCsv.at(row, "укажите ФИО длиной от 2 до 160 символов.");
        if (!isValidName(group)) throw CampusCsv.at(row, "укажите название группы.");
        if (password.isBlank() || password.length() < 8 || password.getBytes(StandardCharsets.UTF_8).length > 72) {
            throw CampusCsv.at(row, "пароль должен содержать от 8 символов и занимать не больше 72 байт.");
        }
        return new StudentImport(row, email, fullName, group, passwords.encode(password));
    }

    private long addGroup(String name, long faculty, String studyForm) {
        return db.sql("INSERT INTO study_group(name, faculty_id, study_form) VALUES (:name, :faculty, :form) RETURNING id")
            .param("name", name).param("faculty", faculty).param("form", studyForm).query(Long.class).single();
    }

    private int updateGroup(long id, String name, long faculty, String studyForm) {
        int updated = db.sql("UPDATE study_group SET name = :name, faculty_id = :faculty, study_form = :form WHERE id = :id")
            .param("name", name).param("faculty", faculty).param("form", studyForm).param("id", id).update();
        if (updated != 0) {
            db.sql("UPDATE campus_user SET faculty_id = :faculty WHERE group_id = :id AND faculty_id IS DISTINCT FROM :faculty")
                .param("faculty", faculty).param("id", id).update();
        }
        return updated;
    }

    private long requireFaculty(Long id) {
        if (id == null || db.sql("SELECT id FROM faculty WHERE id = :id").param("id", id).query(Long.class).optional().isEmpty()) {
            throw invalid("Выберите факультет или институт из справочника.");
        }
        return id;
    }

    private static String validName(String input, String message) {
        String name = input == null ? "" : input.strip();
        if (!isValidName(name)) throw invalid(message);
        return name;
    }

    private static boolean isValidName(String name) {
        return name.length() >= 2 && name.length() <= 160 && name.chars().noneMatch(Character::isISOControl);
    }

    private static String validCode(String input) {
        String code = input == null ? "" : input.strip().toLowerCase(Locale.ROOT);
        if (!CODE.matcher(code).matches()) throw invalid("Код должен содержать до 40 латинских букв, цифр, дефисов или подчёркиваний.");
        return code;
    }

    private static String validStudyForm(String input) {
        if (input == null || !STUDY_FORMS.contains(input)) throw invalid("Выберите форму обучения.");
        return input;
    }

    private static ResponseStatusException invalid(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    private static ResponseStatusException conflict(String message) {
        return new ResponseStatusException(HttpStatus.CONFLICT, message);
    }
}

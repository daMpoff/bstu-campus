package ru.bstu.campus;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
@ConditionalOnProperty(name = "campus.demo", havingValue = "true")
class DemoData implements ApplicationRunner {
    private final JdbcClient db;
    private final PasswordEncoder passwords;
    private final CampusSettings settings;
    private final DemoAccess demoAccess;

    DemoData(JdbcClient db, PasswordEncoder passwords, CampusSettings settings, DemoAccess demoAccess) {
        this.db = db;
        this.passwords = passwords;
        this.settings = settings;
        this.demoAccess = demoAccess;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) throws IOException {
        String scenario = new ClassPathResource("demo/databases-course.sql").getContentAsString(StandardCharsets.UTF_8);
        db.sql("INSERT INTO study_group(name) VALUES ('ИВТ-24'), ('ИВТ-25') ON CONFLICT DO NOTHING").update();
        db.sql("""
            UPDATE study_group SET faculty_id = (SELECT id FROM faculty WHERE code = 'fit')
            WHERE name IN ('ИВТ-24', 'ИВТ-25') AND study_form IS NULL AND faculty_id IS NULL
            """).update();
        String password = passwords.encode("demo2026");
        db.sql("""
            INSERT INTO campus_user(email, password_hash, full_name, role, group_id, email_verified, group_verified)
            VALUES
                ('teacher@bgtu.test', :password, 'Елена Крылова', 'TEACHER', NULL, true, true),
                ('student@bgtu.test', :password, 'Алексей Смирнов', 'STUDENT', (SELECT id FROM study_group WHERE name = 'ИВТ-24'), true, true),
                ('student2@bgtu.test', :password, 'Мария Волкова', 'STUDENT', (SELECT id FROM study_group WHERE name = 'ИВТ-24'), true, true),
                ('student3@bgtu.test', :password, 'Даниил Петров', 'STUDENT', (SELECT id FROM study_group WHERE name = 'ИВТ-25'), true, true)
            ON CONFLICT (email) DO NOTHING
            """).param("password", password).update();
        if (demoAccess.adminEnabled()) {
            db.sql("""
                INSERT INTO campus_user(email, password_hash, full_name, role, email_verified, group_verified)
                VALUES (:email, :password, 'Администратор БГТУ', 'ADMIN', true, true)
                ON CONFLICT (email) DO NOTHING
                """).param("email", DemoAccess.ADMIN_EMAIL).param("password", password).update();
        }
        db.sql("""
            UPDATE campus_user SET department_id = (SELECT id FROM department WHERE code = 'iipo')
            WHERE email = 'teacher@bgtu.test' AND role = 'TEACHER' AND department_id IS NULL
            """).update();
        db.sql("""
            WITH seed AS (
                INSERT INTO campus_demo_seed(scenario) VALUES ('group-responsibilities')
                ON CONFLICT DO NOTHING RETURNING scenario
            )
            INSERT INTO group_responsible_teacher(group_id, teacher_id)
            SELECT g.id, t.id
            FROM seed CROSS JOIN study_group g CROSS JOIN campus_user t
            WHERE g.name IN ('ИВТ-24', 'ИВТ-25') AND g.study_form IS NULL
              AND t.email = 'teacher@bgtu.test' AND t.role = 'TEACHER'
            ON CONFLICT DO NOTHING
            """).update();
        // The SQL block reads the active rules so its deadlines and awards agree with the rest of the demo.
        var rules = settings.current();
        db.sql("SELECT set_config('campus.demo_budget', :budget, true), set_config('campus.demo_interval', :interval, true)")
            .param("budget", Integer.toString(rules.activityMonthlyLimit()))
            .param("interval", Integer.toString(rules.penaltyIntervalSeconds()))
            .query((row, index) -> row.getString(1)).single();
        db.sql(scenario).update();
    }
}

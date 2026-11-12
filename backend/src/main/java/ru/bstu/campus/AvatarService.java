package ru.bstu.campus;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
class AvatarService {
    private final JdbcClient db;
    private final AssignmentService accounts;

    AvatarService(JdbcClient db, AssignmentService accounts) {
        this.db = db;
        this.accounts = accounts;
    }

    static String url(long userId, UUID revision) {
        return revision == null ? null : "/api/avatars/" + userId + "?v=" + revision;
    }

    @Transactional
    AssignmentService.Account save(String email, byte[] image) {
        db.sql("""
            INSERT INTO user_avatar (user_id, revision, content)
            SELECT id, :revision, :content FROM campus_user WHERE email = :email
            ON CONFLICT (user_id) DO UPDATE SET revision = EXCLUDED.revision, content = EXCLUDED.content
            """).param("email", email).param("revision", UUID.randomUUID()).param("content", image).update();
        return accounts.account(email);
    }

    @Transactional
    AssignmentService.Account delete(String email) {
        db.sql("DELETE FROM user_avatar WHERE user_id = (SELECT id FROM campus_user WHERE email = :email)")
            .param("email", email).update();
        return accounts.account(email);
    }

    byte[] image(long userId, String viewer) {
        return db.sql("""
            SELECT avatar.content FROM user_avatar avatar
            JOIN campus_user u ON u.id = avatar.user_id
            WHERE avatar.user_id = :id AND (u.email = :viewer OR (u.role = 'STUDENT' AND u.group_id IS NOT NULL))
            """).param("id", userId).param("viewer", viewer).query((row, index) -> row.getBytes("content")).optional()
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Фото профиля не найдено."));
    }
}

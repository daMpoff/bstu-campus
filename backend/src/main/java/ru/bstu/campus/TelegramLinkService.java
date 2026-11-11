package ru.bstu.campus;

import static ru.bstu.campus.AssignmentService.timestamp;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
class TelegramLinkService {
    private static final String ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    private static final Duration CODE_LIFETIME = Duration.ofMinutes(10);

    private final SecureRandom random = new SecureRandom();
    private final JdbcClient db;
    private final TelegramBotApi bot;
    private final Clock clock;

    TelegramLinkService(JdbcClient db, TelegramBotApi bot, Clock clock) {
        this.db = db;
        this.bot = bot;
        this.clock = clock;
    }

    record Status(boolean configured, String botUsername, boolean connected) {}
    record PairingCode(String code, Instant expiresAt) {}
    enum Pairing { CONNECTED, INVALID_CODE, CHAT_ALREADY_CONNECTED }

    Status status(long account) {
        boolean connected = bot.configured() && connectedAccount(account);
        return new Status(bot.configured(), bot.botUsername(), connected);
    }

    @Transactional
    PairingCode issue(long account) {
        if (!bot.configured()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Telegram-бот ещё не настроен.");
        }
        if (!lockAccount(account)) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        if (connectedAccount(account)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Telegram уже подключён к этому профилю.");
        }
        StringBuilder raw = new StringBuilder(12);
        for (int index = 0; index < 12; index++) raw.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        String code = raw.toString();
        Instant expires = clock.instant().plus(CODE_LIFETIME);
        db.sql("""
            INSERT INTO telegram_pairing_code (bot_id, user_id, code_hash, expires_at)
            VALUES (:bot, :account, :hash, :expires)
            ON CONFLICT (bot_id, user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at
            """).param("bot", bot.botId()).param("account", account).param("hash", hash(code))
            .param("expires", timestamp(expires)).update();
        return new PairingCode(code.substring(0, 4) + "-" + code.substring(4, 8) + "-" + code.substring(8), expires);
    }

    @Transactional
    Status disconnect(long account) {
        if (bot.configured()) {
            if (!lockAccount(account)) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
            db.sql("DELETE FROM telegram_pairing_code WHERE bot_id = :bot AND user_id = :account")
                .param("bot", bot.botId()).param("account", account).update();
            db.sql("DELETE FROM telegram_chat WHERE bot_id = :bot AND user_id = :account")
                .param("bot", bot.botId()).param("account", account).update();
        }
        return status(account);
    }

    @Transactional
    Pairing bind(long chatId, String text) {
        String code = text.toUpperCase(Locale.ROOT).replaceAll("[\\s-]", "");
        if (!code.matches("[0-9A-HJKMNP-TV-Z]{12}")) return Pairing.INVALID_CODE;
        byte[] hash = hash(code);
        var lookup = db.sql("""
            SELECT user_id FROM telegram_pairing_code WHERE bot_id = :bot AND code_hash = :hash AND expires_at > :now
            """).param("bot", bot.botId()).param("hash", hash).param("now", timestamp(clock.instant()))
            .query(Long.class).optional();
        if (lookup.isEmpty() || !lockAccount(lookup.get())) return Pairing.INVALID_CODE;
        long account = lookup.get();
        var now = timestamp(clock.instant());
        int bound = db.sql("""
            INSERT INTO telegram_chat (bot_id, user_id, chat_id, linked_at)
            SELECT bot_id, user_id, :chat, :now FROM telegram_pairing_code
            WHERE bot_id = :bot AND user_id = :account AND code_hash = :hash AND expires_at > :now
            ON CONFLICT DO NOTHING
            """).param("bot", bot.botId()).param("account", account).param("hash", hash)
            .param("chat", chatId).param("now", now).update();
        if (bound == 0) {
            return connectedChat(chatId) ? Pairing.CHAT_ALREADY_CONNECTED : Pairing.INVALID_CODE;
        }
        db.sql("DELETE FROM telegram_pairing_code WHERE bot_id = :bot AND user_id = :account")
            .param("bot", bot.botId()).param("account", account).update();
        return Pairing.CONNECTED;
    }

    boolean connectedChat(long chatId) {
        return db.sql("SELECT EXISTS (SELECT 1 FROM telegram_chat WHERE bot_id = :bot AND chat_id = :chat)")
            .param("bot", bot.botId()).param("chat", chatId).query(Boolean.class).single();
    }

    boolean disconnectChat(long chatId) {
        return db.sql("DELETE FROM telegram_chat WHERE bot_id = :bot AND chat_id = :chat")
            .param("bot", bot.botId()).param("chat", chatId).update() != 0;
    }

    private boolean connectedAccount(long account) {
        return db.sql("SELECT EXISTS (SELECT 1 FROM telegram_chat WHERE bot_id = :bot AND user_id = :account)")
            .param("bot", bot.botId()).param("account", account).query(Boolean.class).single();
    }

    private boolean lockAccount(long account) {
        return db.sql("SELECT id FROM campus_user WHERE id = :account AND email_verified FOR UPDATE")
            .param("account", account).query(Long.class).optional().isPresent();
    }

    private static byte[] hash(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.US_ASCII));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}

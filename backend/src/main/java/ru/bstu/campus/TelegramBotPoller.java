package ru.bstu.campus;

import static ru.bstu.campus.AssignmentService.timestamp;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import tools.jackson.databind.JsonNode;

@Service
class TelegramBotPoller {
    private static final Logger log = LoggerFactory.getLogger(TelegramBotPoller.class);
    private final JdbcClient db;
    private final TransactionTemplate transactions;
    private final TelegramBotApi bot;
    private final TelegramLinkService links;
    private final Clock clock;
    private Instant retryAt = Instant.MIN;

    TelegramBotPoller(JdbcClient db, TransactionTemplate transactions, TelegramBotApi bot,
                      TelegramLinkService links, Clock clock) {
        this.db = db;
        this.transactions = transactions;
        this.bot = bot;
        this.links = links;
        this.clock = clock;
    }

    private record Cursor(Long nextUpdateId, OffsetDateTime lastUpdateAt) {}
    private record Reply(long chatId, String text) {}

    @Scheduled(fixedDelayString = "${campus.telegram.poll-delay:1s}")
    void poll() {
        if (!bot.hasToken() || clock.instant().isBefore(retryAt)) return;
        try {
            if (!bot.configured() && !bot.verifyIdentity()) {
                retryAt = clock.instant().plusSeconds(60);
                log.warn("Проверьте, что токен Telegram принадлежит боту с указанным CAMPUS_TELEGRAM_BOT_USERNAME.");
                return;
            }
            db.sql("INSERT INTO telegram_poll_cursor (bot_id) VALUES (:bot) ON CONFLICT DO NOTHING")
                .param("bot", bot.botId()).update();
            List<Reply> replies = transactions.execute(status -> readUpdates());
            for (Reply reply : replies) sendReply(reply);
        } catch (TelegramBotApi.Failure failure) {
            retryAt = clock.instant().plusSeconds(Math.max(30, failure.retryAfter()));
            log.warn("Не удалось получить сообщения Telegram. Код: {}.", failure.status());
        }
    }

    private List<Reply> readUpdates() {
        var locked = db.sql("""
            SELECT next_update_id, last_update_at FROM telegram_poll_cursor WHERE bot_id = :bot FOR UPDATE SKIP LOCKED
            """).param("bot", bot.botId()).query(Cursor.class).optional();
        if (locked.isEmpty()) return List.of();
        Cursor cursor = locked.get();
        // After a week without updates Telegram may start a new sequence of update IDs.
        Long offset = cursor.lastUpdateAt() != null
            && cursor.lastUpdateAt().toInstant().isAfter(clock.instant().minus(Duration.ofDays(6)))
            ? cursor.nextUpdateId() : null;
        JsonNode updates = bot.updates(offset);
        var replies = new ArrayList<Reply>();
        Long nextOffset = offset;
        for (JsonNode update : updates) {
            long id = update.path("update_id").longValue(-1);
            if (id < 0 || (nextOffset != null && id < nextOffset)) continue;
            Reply reply = handleMessage(update.path("message"));
            if (reply != null) replies.add(reply);
            nextOffset = id + 1;
        }
        if (nextOffset != null && !nextOffset.equals(offset)) {
            db.sql("UPDATE telegram_poll_cursor SET next_update_id = :next, last_update_at = :now WHERE bot_id = :bot")
                .param("next", nextOffset).param("now", timestamp(clock.instant())).param("bot", bot.botId()).update();
        }
        return replies;
    }

    private Reply handleMessage(JsonNode message) {
        JsonNode chat = message.path("chat");
        JsonNode sender = message.path("from");
        long chatId = chat.path("id").longValue(0);
        String input = message.path("text").stringValue("").strip();
        if (chatId <= 0 || !"private".equals(chat.path("type").stringValue(""))
            || sender.path("is_bot").booleanValue(true) || sender.path("id").longValue(0) != chatId
            || input.isEmpty()) return null;
        String[] parts = input.split("\\s+", 2);
        String command = parts[0].split("@", 2)[0].toLowerCase(Locale.ROOT);
        String reply = switch (command) {
            case "/stop" -> links.disconnectChat(chatId)
                ? "Уведомления отключены. Для подключения запросите новый код в настройках профиля БГТУ."
                : "Подключение к профилю БГТУ ещё не настроено.";
            case "/start" -> parts.length == 2 ? bind(chatId, parts[1]) : help(chatId);
            case "/help" -> help(chatId);
            default -> input.startsWith("/") ? help(chatId) : bind(chatId, input);
        };
        return new Reply(chatId, reply);
    }

    private String help(long chatId) {
        return links.connectedChat(chatId)
            ? "Telegram подключён к вашему профилю БГТУ. Чтобы отключить уведомления, отправьте /stop."
            : "Откройте настройки профиля БГТУ, покажите код подключения Telegram и пришлите его сюда.";
    }

    private String bind(long chatId, String code) {
        return switch (links.bind(chatId, code)) {
            case CONNECTED -> "Telegram подключён. Буду присылать события кампуса и напоминания о сроках сдачи.\n"
                + "Чтобы отключить уведомления, отправьте /stop.";
            case INVALID_CODE -> "Код не подошёл или истёк. Запросите новый в настройках профиля БГТУ.";
            case CHAT_ALREADY_CONNECTED -> "Этот чат уже подключён к профилю БГТУ. Для смены профиля сначала отправьте /stop.";
        };
    }

    private void sendReply(Reply reply) {
        try {
            bot.send(reply.chatId(), reply.text());
        } catch (TelegramBotApi.Failure failure) {
            log.warn("Telegram не принял ответ бота. Код: {}.", failure.status());
        }
    }
}

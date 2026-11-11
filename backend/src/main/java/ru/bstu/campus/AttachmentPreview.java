package ru.bstu.campus;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;

import org.springframework.http.MediaType;

final class AttachmentPreview {
    private static final MediaType WEBP = MediaType.valueOf("image/webp");
    private static final MediaType UTF8_TEXT = new MediaType(MediaType.TEXT_PLAIN, StandardCharsets.UTF_8);
    private static final byte[] PNG_HEADER = {(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10, 0, 0, 0, 13, 'I', 'H', 'D', 'R'};
    private static final byte[] JPEG_HEADER = {(byte) 0xff, (byte) 0xd8, (byte) 0xff};

    private AttachmentPreview() {}

    static Optional<MediaType> type(String name, byte[] content) {
        if (content == null || content.length == 0) return Optional.empty();
        MediaType type = switch (extension(name)) {
            case "pdf" -> isPdf(content) ? MediaType.APPLICATION_PDF : null;
            case "png" -> content.length >= 33 && matches(content, 0, PNG_HEADER) ? MediaType.IMAGE_PNG : null;
            case "jpg", "jpeg" -> content.length >= 4 && matches(content, 0, JPEG_HEADER) ? MediaType.IMAGE_JPEG : null;
            case "gif" -> content.length >= 13 && (ascii(content, 0, "GIF87a") || ascii(content, 0, "GIF89a"))
                ? MediaType.IMAGE_GIF : null;
            case "webp" -> isWebp(content) ? WEBP : null;
            case "txt" -> isPlainText(content) ? UTF8_TEXT : null;
            default -> null;
        };
        return Optional.ofNullable(type);
    }

    private static boolean isPdf(byte[] content) {
        if (content.length < 15 || !ascii(content, 0, "%PDF-") || content[6] != '.'
                || content[5] < '1' || content[5] > '2' || content[7] < '0' || content[7] > '9') return false;
        byte[] eof = "%%EOF".getBytes(StandardCharsets.US_ASCII);
        for (int offset = content.length - eof.length; offset >= Math.max(8, content.length - 1024); offset--) {
            if (matches(content, offset, eof)) return true;
        }
        return false;
    }

    private static boolean isWebp(byte[] content) {
        if (content.length < 20 || !ascii(content, 0, "RIFF") || !ascii(content, 8, "WEBP")) return false;
        long riffSize = Integer.toUnsignedLong(ByteBuffer.wrap(content).order(ByteOrder.LITTLE_ENDIAN).getInt(4));
        return riffSize + 8 == content.length
            && (ascii(content, 12, "VP8 ") || ascii(content, 12, "VP8L") || ascii(content, 12, "VP8X"));
    }

    private static boolean isPlainText(byte[] content) {
        try {
            CharBuffer text = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(content));
            if (text.chars().anyMatch(ch -> Character.isISOControl(ch) && ch != '\n' && ch != '\r' && ch != '\t')) return false;
            int start = 0;
            while (start < text.length() && (text.charAt(start) == '\ufeff' || Character.isWhitespace(text.charAt(start)))) start++;
            String prefix = text.subSequence(start, Math.min(start + 12, text.length())).toString().toLowerCase(Locale.ROOT);
            return !prefix.startsWith("<!doctype") && !prefix.startsWith("<html") && !prefix.startsWith("<svg") && !prefix.startsWith("<?xml");
        } catch (CharacterCodingException invalidEncoding) {
            return false;
        }
    }

    private static String extension(String name) {
        if (name == null) return "";
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    private static boolean ascii(byte[] content, int offset, String signature) {
        return matches(content, offset, signature.getBytes(StandardCharsets.US_ASCII));
    }

    private static boolean matches(byte[] content, int offset, byte[] signature) {
        return content.length - offset >= signature.length
            && Arrays.equals(content, offset, offset + signature.length, signature, 0, signature.length);
    }
}

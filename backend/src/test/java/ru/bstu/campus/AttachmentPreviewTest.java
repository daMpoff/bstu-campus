package ru.bstu.campus;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.http.MediaType;

class AttachmentPreviewTest {
    @ParameterizedTest
    @CsvSource({"PNG,image/png", "JPEG,image/jpeg", "GIF,image/gif"})
    void recognizesRasterImagesByTheirFileNameAndHeader(String extension, String mediaType) throws IOException {
        try (var buffer = new ByteArrayOutputStream()) {
            assertTrue(ImageIO.write(new BufferedImage(1, 1, BufferedImage.TYPE_INT_RGB), extension, buffer));
            byte[] image = buffer.toByteArray();
            assertEquals(mediaType, AttachmentPreview.type("Работа." + extension, image).orElseThrow().toString());
            assertTrue(AttachmentPreview.type("Работа.pdf", image).isEmpty());
        }
    }

    @Test
    void recognizesStandardPdfAndWebpSignatures() {
        assertEquals(MediaType.APPLICATION_PDF, AttachmentPreview.type("Работа.PDF", utf8("%PDF-1.7\n%%EOF\n")).orElseThrow());
        byte[] webp = Base64.getDecoder().decode("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA");
        assertEquals("image/webp", AttachmentPreview.type("Работа.webp", webp).orElseThrow().toString());
        assertTrue(AttachmentPreview.type("Работа.webp", java.util.Arrays.copyOf(webp, webp.length - 1)).isEmpty());
    }

    @Test
    void recognizesUtf8TextAndRejectsBinaryAndActiveDocumentFormats() {
        MediaType text = AttachmentPreview.type("Работа.TXT", utf8("Пример\r\n\tРезультат")).orElseThrow();
        assertEquals(MediaType.TEXT_PLAIN, new MediaType(text.getType(), text.getSubtype()));
        assertEquals(StandardCharsets.UTF_8, text.getCharset());
        assertTrue(AttachmentPreview.type("Работа.txt", new byte[] {0, 3, 7}).isEmpty());
        assertTrue(AttachmentPreview.type("Работа.txt", new byte[] {(byte) 0xc3, (byte) 0x28}).isEmpty());
        assertTrue(AttachmentPreview.type("Работа.txt", utf8("\ufeff \n<html>Заголовок</html>")).isEmpty());
        assertTrue(AttachmentPreview.type("Работа.svg", utf8("<svg xmlns='http://www.w3.org/2000/svg'/> ")).isEmpty());
        assertTrue(AttachmentPreview.type("Работа.pdf", utf8("%PDF-1.7\nСодержимое файла")).isEmpty());
        assertFalse(AttachmentPreview.supportsName("Работа.docx"));
    }

    private static byte[] utf8(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }
}

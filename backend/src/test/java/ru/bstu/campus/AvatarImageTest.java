package ru.bstu.campus;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import javax.imageio.ImageIO;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.server.ResponseStatusException;

class AvatarImageTest {
    @ParameterizedTest
    @ValueSource(strings = {"JPEG", "PNG"})
    void scalesAndReencodesSupportedPhotos(String format) throws IOException {
        byte[] source = image(format, 1280, 640);
        byte[] trailer = "unrelated-original-data".getBytes(StandardCharsets.US_ASCII);
        var upload = new ByteArrayOutputStream();
        upload.write(source);
        upload.write(trailer);

        byte[] normalized = AvatarImage.normalize(file(upload.toByteArray()));
        assertFalse(new String(normalized, StandardCharsets.ISO_8859_1).contains("unrelated-original-data"));
        try (var input = ImageIO.createImageInputStream(new ByteArrayInputStream(normalized))) {
            var reader = ImageIO.getImageReaders(input).next();
            try {
                reader.setInput(input);
                assertEquals("png", reader.getFormatName());
                assertEquals(512, reader.getWidth(0));
                assertEquals(256, reader.getHeight(0));
            } finally {
                reader.dispose();
            }
        }
    }

    @Test
    void rejectsUnsupportedAndUnreadableFilesEvenWhenClaimedToBePng() throws IOException {
        for (byte[] contents : new byte[][] {image("GIF", 32, 32), {0, 1, 2, 3}}) {
            var failure = assertThrows(ResponseStatusException.class, () -> AvatarImage.normalize(file(contents)));
            assertEquals(HttpStatus.BAD_REQUEST, failure.getStatusCode());
        }
    }

    @Test
    void rotatesJpegPixelsUsingExifBeforeDroppingTheMetadata() throws IOException {
        byte[] source = image("JPEG", 48, 24);
        // The EXIF APP1 segment contains a single IFD0 tag 0x0112 with orientation 6 (90° clockwise).
        byte[] app1 = HexFormat.of().parseHex("ffe100224578696600004d4d002a00000008000101120003000000010006000000000000");
        int firstSegmentEnd = 4 + (Byte.toUnsignedInt(source[4]) << 8) + Byte.toUnsignedInt(source[5]);
        var upload = new ByteArrayOutputStream();
        upload.write(source, 0, firstSegmentEnd);
        upload.write(app1);
        upload.write(source, firstSegmentEnd, source.length - firstSegmentEnd);

        byte[] result = AvatarImage.normalize(file(upload.toByteArray()));
        var rotated = ImageIO.read(new ByteArrayInputStream(result));
        assertEquals(24, rotated.getWidth());
        assertEquals(48, rotated.getHeight());
        assertFalse(new String(result, StandardCharsets.ISO_8859_1).contains("Exif"));
    }

    @Test
    void limitsBytesAndSourceDimensions() throws IOException {
        var oversized = assertThrows(ResponseStatusException.class,
            () -> AvatarImage.normalize(file(new byte[AvatarImage.MAX_BYTES + 1])));
        assertEquals(HttpStatus.CONTENT_TOO_LARGE, oversized.getStatusCode());
        byte[] wide = image("PNG", 8200, 1);
        var invalidDimensions = assertThrows(ResponseStatusException.class, () -> AvatarImage.normalize(file(wide)));
        assertEquals(HttpStatus.BAD_REQUEST, invalidDimensions.getStatusCode());
        assertEquals("Слишком большое разрешение фото.", invalidDimensions.getReason());
    }

    private static MockMultipartFile file(byte[] bytes) {
        return new MockMultipartFile("file", "avatar.png", "image/png", bytes);
    }

    private static byte[] image(String format, int width, int height) throws IOException {
        var bytes = new ByteArrayOutputStream();
        assertTrue(ImageIO.write(new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB), format, bytes));
        return bytes.toByteArray();
    }
}

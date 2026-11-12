package ru.bstu.campus;

import java.awt.RenderingHints;
import java.awt.geom.AffineTransform;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.metadata.IIOMetadataNode;
import javax.imageio.stream.MemoryCacheImageInputStream;
import javax.imageio.stream.MemoryCacheImageOutputStream;

import org.springframework.http.HttpStatus;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

final class AvatarImage {
    static final int MAX_BYTES = 5 * 1024 * 1024;
    static final int MAX_EDGE = 512;
    private static final int MAX_SOURCE_EDGE = 8192;
    private static final long MAX_SOURCE_PIXELS = 16_000_000;
    private static final byte[] EXIF_HEADER = {'E', 'x', 'i', 'f', 0, 0};

    private AvatarImage() {}

    static byte[] normalize(MultipartFile file) {
        if (file.getSize() > MAX_BYTES) {
            throw new ResponseStatusException(HttpStatus.CONTENT_TOO_LARGE, "Фото должно быть не больше 5 МБ.");
        }
        if (file.isEmpty()) throw invalidImage();

        BufferedImage image;
        try (var source = file.getInputStream(); var input = new MemoryCacheImageInputStream(source)) {
            var readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) throw invalidImage();
            var reader = readers.next();
            try {
                String format = reader.getFormatName();
                boolean jpeg = format.equalsIgnoreCase("JPEG");
                if (!jpeg && !format.equalsIgnoreCase("PNG")) throw invalidImage();
                reader.setInput(input, !jpeg, !jpeg);
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if (width < 1 || height < 1 || width > MAX_SOURCE_EDGE || height > MAX_SOURCE_EDGE
                        || (long) width * height > MAX_SOURCE_PIXELS) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Слишком большое разрешение фото.");
                }
                var params = reader.getDefaultReadParam();
                int subsampling = Math.max(1, Math.max(width, height) / MAX_EDGE);
                params.setSourceSubsampling(subsampling, subsampling, 0, 0);
                int orientation = jpeg ? jpegOrientation(reader) : 1;
                image = scale(reader.read(0, params), width, height, orientation);
            } finally {
                reader.dispose();
            }
        } catch (IOException | IllegalArgumentException | IndexOutOfBoundsException failure) {
            throw invalidImage();
        }

        var bytes = new ByteArrayOutputStream();
        try (var output = new MemoryCacheImageOutputStream(bytes)) {
            if (!ImageIO.write(image, "PNG", output)) throw new IOException("PNG writer unavailable");
        } catch (IOException failure) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Не удалось сохранить фото.", failure);
        }
        return bytes.toByteArray();
    }

    private static int jpegOrientation(ImageReader reader) {
        try {
            var metadata = reader.getImageMetadata(0);
            if (metadata == null) return 1;
            var root = (IIOMetadataNode) metadata.getAsTree("javax_imageio_jpeg_image_1.0");
            var markers = root.getElementsByTagName("unknown");
            for (int index = 0; index < markers.getLength(); index++) {
                var marker = (IIOMetadataNode) markers.item(index);
                if ("225".equals(marker.getAttribute("MarkerTag")) && marker.getUserObject() instanceof byte[] data
                        && data.length >= EXIF_HEADER.length + 8
                        && Arrays.equals(data, 0, EXIF_HEADER.length, EXIF_HEADER, 0, EXIF_HEADER.length)) {
                    return exifOrientation(ByteBuffer.wrap(data, EXIF_HEADER.length, data.length - EXIF_HEADER.length).slice());
                }
            }
        } catch (IOException failure) {
            // An unreadable optional metadata block should not prevent decoding the image.
        }
        return 1;
    }

    private static int exifOrientation(ByteBuffer tiff) {
        // Read just the orientation tag from the primary TIFF directory, without following metadata pointers.
        short byteOrder = tiff.getShort(0);
        if (byteOrder == 0x4949) tiff.order(ByteOrder.LITTLE_ENDIAN);
        else if (byteOrder != 0x4d4d) return 1;
        if (tiff.getShort(2) != 42) return 1;
        int directory = tiff.getInt(4);
        if (directory < 8 || directory > tiff.limit() - 2) return 1;
        int entries = Short.toUnsignedInt(tiff.getShort(directory));
        int start = directory + 2;
        if (entries > (tiff.limit() - start) / 12) return 1;
        for (int offset = start; offset < start + entries * 12; offset += 12) {
            if (tiff.getShort(offset) == 0x0112 && tiff.getShort(offset + 2) == 3 && tiff.getInt(offset + 4) == 1) {
                int orientation = tiff.getShort(offset + 8);
                return orientation >= 1 && orientation <= 8 ? orientation : 1;
            }
        }
        return 1;
    }

    private static BufferedImage scale(BufferedImage source, int width, int height, int orientation) {
        double ratio = Math.min(1.0, (double) MAX_EDGE / Math.max(width, height));
        int w = Math.max(1, (int) Math.round(width * ratio));
        int h = Math.max(1, (int) Math.round(height * ratio));
        boolean swapAxes = orientation >= 5;
        var result = new BufferedImage(swapAxes ? h : w, swapAxes ? w : h, BufferedImage.TYPE_INT_ARGB);
        var graphics = result.createGraphics();
        try {
            graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            graphics.transform(switch (orientation) {
                case 2 -> new AffineTransform(-1, 0, 0, 1, w, 0);
                case 3 -> new AffineTransform(-1, 0, 0, -1, w, h);
                case 4 -> new AffineTransform(1, 0, 0, -1, 0, h);
                case 5 -> new AffineTransform(0, 1, 1, 0, 0, 0);
                case 6 -> new AffineTransform(0, 1, -1, 0, h, 0);
                case 7 -> new AffineTransform(0, -1, -1, 0, h, w);
                case 8 -> new AffineTransform(0, -1, 1, 0, 0, w);
                default -> new AffineTransform();
            });
            graphics.drawImage(source, 0, 0, w, h, null);
        } finally {
            graphics.dispose();
        }
        return result;
    }

    private static ResponseStatusException invalidImage() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "Выберите корректное изображение JPEG или PNG.");
    }
}

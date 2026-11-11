package ru.bstu.campus;

import java.io.IOException;

import org.springframework.http.HttpStatus;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

record AssignmentUpload(String name, byte[] content) {
    static AssignmentUpload read(MultipartFile file) throws IOException {
        if (file == null || file.isEmpty()) return null;
        String name = file.getOriginalFilename();
        name = name == null ? "work" : name.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}]", "").strip();
        if (name.isEmpty() || name.length() > 180) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Укажите имя файла длиной до 180 символов.");
        }
        return new AssignmentUpload(name, file.getBytes());
    }
}

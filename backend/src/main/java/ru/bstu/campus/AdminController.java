package ru.bstu.campus;

import java.io.IOException;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/admin")
class AdminController {
    private final AdminService admin;
    private final CampusSettings settings;

    AdminController(AdminService admin, CampusSettings settings) {
        this.admin = admin;
        this.settings = settings;
    }

    record Created(long id) {}

    @GetMapping("/catalog")
    AdminService.Catalog catalog() {
        return admin.catalog();
    }

    @PostMapping("/catalog/{kind}")
    @ResponseStatus(HttpStatus.CREATED)
    Created create(@PathVariable String kind, @RequestBody AdminService.Entry input) {
        return new Created(admin.create(AdminService.Kind.fromPath(kind), input));
    }

    @PutMapping("/catalog/{kind}/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void update(@PathVariable String kind, @PathVariable long id, @RequestBody AdminService.Entry input) {
        admin.update(AdminService.Kind.fromPath(kind), id, input);
    }

    @DeleteMapping("/catalog/{kind}/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(@PathVariable String kind, @PathVariable long id) {
        admin.delete(AdminService.Kind.fromPath(kind), id);
    }

    @PostMapping(value = "/import/{kind}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    AdminService.Imported upload(@PathVariable String kind, @RequestParam MultipartFile file) throws IOException {
        if (file.getSize() > CampusCsv.MAX_BYTES) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Файл CSV должен быть не больше 512 КБ.");
        }
        return switch (kind) {
            case "groups" -> admin.importGroups(file.getBytes());
            case "students" -> admin.importStudents(file.getBytes());
            default -> throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Вид импорта не найден.");
        };
    }

    @GetMapping("/settings")
    CampusSettings.Values settings() {
        return settings.current();
    }

    @PutMapping("/settings")
    CampusSettings.Values save(@RequestBody CampusSettings.Update input) {
        return settings.save(input);
    }
}

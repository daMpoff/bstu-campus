package ru.bstu.campus;

import java.security.Principal;

import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api")
class AvatarController {
    private final AvatarService avatars;

    AvatarController(AvatarService avatars) {
        this.avatars = avatars;
    }

    @PutMapping(value = "/me/avatar", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    AssignmentService.Account upload(Principal user, @RequestParam("file") MultipartFile file) {
        return avatars.save(user.getName(), AvatarImage.normalize(file));
    }

    @DeleteMapping("/me/avatar")
    AssignmentService.Account delete(Principal user) {
        return avatars.delete(user.getName());
    }

    @GetMapping(value = "/avatars/{id}", produces = MediaType.IMAGE_PNG_VALUE)
    ResponseEntity<byte[]> avatar(Principal user, @PathVariable long id) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.IMAGE_PNG)
            .body(avatars.image(id, user.getName()));
    }
}

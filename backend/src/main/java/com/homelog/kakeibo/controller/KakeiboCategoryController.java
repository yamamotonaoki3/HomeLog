package com.homelog.kakeibo.controller;

import static com.homelog.common.security.CurrentUserProvider.currentUserId;

import com.homelog.kakeibo.dto.request.CreateCategoryRequest;
import com.homelog.kakeibo.dto.request.UpdateCategoryRequest;
import com.homelog.kakeibo.dto.response.CategoryResponse;
import com.homelog.kakeibo.service.KakeiboCategoryService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/kakeibo-categories")
public class KakeiboCategoryController {

    private final KakeiboCategoryService kakeiboCategoryService;

    public KakeiboCategoryController(KakeiboCategoryService kakeiboCategoryService) {
        this.kakeiboCategoryService = kakeiboCategoryService;
    }

    @GetMapping
    public List<CategoryResponse> listCategories() {
        return kakeiboCategoryService.listCategories(currentUserId());
    }

    @PostMapping
    public ResponseEntity<CategoryResponse> createCategory(@Valid @RequestBody CreateCategoryRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(kakeiboCategoryService.createCategory(currentUserId(), request));
    }

    @PatchMapping("/{id}")
    public CategoryResponse updateCategory(@PathVariable Long id, @Valid @RequestBody UpdateCategoryRequest request) {
        return kakeiboCategoryService.updateCategory(currentUserId(), id, request);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteCategory(@PathVariable Long id) {
        kakeiboCategoryService.deleteCategory(currentUserId(), id);
        return ResponseEntity.noContent().build();
    }
}

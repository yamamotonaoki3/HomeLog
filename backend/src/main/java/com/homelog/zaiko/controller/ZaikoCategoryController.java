package com.homelog.zaiko.controller;

import static com.homelog.common.security.CurrentUserProvider.currentUserId;

import com.homelog.zaiko.dto.request.CreateCategoryRequest;
import com.homelog.zaiko.dto.request.UpdateCategoryRequest;
import com.homelog.zaiko.dto.response.CategoryResponse;
import com.homelog.zaiko.service.ZaikoCategoryService;
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
@RequestMapping("/api/zaiko-categories")
public class ZaikoCategoryController {

    private final ZaikoCategoryService zaikoCategoryService;

    public ZaikoCategoryController(ZaikoCategoryService zaikoCategoryService) {
        this.zaikoCategoryService = zaikoCategoryService;
    }

    @GetMapping
    public List<CategoryResponse> listCategories() {
        return zaikoCategoryService.listCategories(currentUserId());
    }

    @PostMapping
    public ResponseEntity<CategoryResponse> createCategory(@Valid @RequestBody CreateCategoryRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(zaikoCategoryService.createCategory(currentUserId(), request));
    }

    @PatchMapping("/{id}")
    public CategoryResponse updateCategory(@PathVariable Long id, @Valid @RequestBody UpdateCategoryRequest request) {
        return zaikoCategoryService.updateCategory(currentUserId(), id, request);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteCategory(@PathVariable Long id) {
        zaikoCategoryService.deleteCategory(currentUserId(), id);
        return ResponseEntity.noContent().build();
    }
}

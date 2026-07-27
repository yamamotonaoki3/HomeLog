package com.homelog.kakeibo.controller;

import static com.homelog.common.security.CurrentUserProvider.currentUserId;

import com.homelog.kakeibo.dto.request.CreateIncomeCategoryRequest;
import com.homelog.kakeibo.dto.request.UpdateIncomeCategoryRequest;
import com.homelog.kakeibo.dto.response.IncomeCategoryResponse;
import com.homelog.kakeibo.service.IncomeCategoryService;
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
@RequestMapping("/api/income-categories")
public class IncomeCategoryController {

    private final IncomeCategoryService incomeCategoryService;

    public IncomeCategoryController(IncomeCategoryService incomeCategoryService) {
        this.incomeCategoryService = incomeCategoryService;
    }

    @GetMapping
    public List<IncomeCategoryResponse> listCategories() {
        return incomeCategoryService.listCategories(currentUserId());
    }

    @PostMapping
    public ResponseEntity<IncomeCategoryResponse> createCategory(
            @Valid @RequestBody CreateIncomeCategoryRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(incomeCategoryService.createCategory(currentUserId(), request));
    }

    @PatchMapping("/{id}")
    public IncomeCategoryResponse updateCategory(@PathVariable Long id,
            @Valid @RequestBody UpdateIncomeCategoryRequest request) {
        return incomeCategoryService.updateCategory(currentUserId(), id, request);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteCategory(@PathVariable Long id) {
        incomeCategoryService.deleteCategory(currentUserId(), id);
        return ResponseEntity.noContent().build();
    }
}

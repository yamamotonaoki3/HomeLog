package com.homelog.zaiko.controller;

import static com.homelog.common.security.CurrentUserProvider.currentUserId;

import com.homelog.zaiko.dto.request.CreateStoreRequest;
import com.homelog.zaiko.dto.request.UpdateStoreRequest;
import com.homelog.zaiko.dto.response.StoreResponse;
import com.homelog.zaiko.service.StoreService;
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
@RequestMapping("/api/stores")
public class StoreController {

    private final StoreService storeService;

    public StoreController(StoreService storeService) {
        this.storeService = storeService;
    }

    @GetMapping
    public List<StoreResponse> listStores() {
        return storeService.listStores(currentUserId());
    }

    @PostMapping
    public ResponseEntity<StoreResponse> createStore(@Valid @RequestBody CreateStoreRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(storeService.createStore(currentUserId(), request));
    }

    @PatchMapping("/{id}")
    public StoreResponse updateStore(@PathVariable Long id, @Valid @RequestBody UpdateStoreRequest request) {
        return storeService.updateStore(currentUserId(), id, request);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteStore(@PathVariable Long id) {
        storeService.deleteStore(currentUserId(), id);
        return ResponseEntity.noContent().build();
    }
}

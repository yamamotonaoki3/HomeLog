package com.homelog.zaiko.controller;

import static com.homelog.common.security.CurrentUserProvider.currentUserId;

import com.homelog.zaiko.dto.request.CreateInventoryItemRequest;
import com.homelog.zaiko.dto.request.QuantityAdjustRequest;
import com.homelog.zaiko.dto.request.UpdateInventoryItemRequest;
import com.homelog.zaiko.dto.response.InventoryItemResponse;
import com.homelog.zaiko.dto.response.QuantityResponse;
import com.homelog.zaiko.service.InventoryItemService;
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
@RequestMapping("/api/inventory-items")
public class InventoryItemController {

    private final InventoryItemService inventoryItemService;

    public InventoryItemController(InventoryItemService inventoryItemService) {
        this.inventoryItemService = inventoryItemService;
    }

    @GetMapping
    public List<InventoryItemResponse> listItems() {
        return inventoryItemService.listItems(currentUserId());
    }

    @PostMapping
    public ResponseEntity<InventoryItemResponse> createItem(
            @Valid @RequestBody CreateInventoryItemRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(inventoryItemService.createItem(currentUserId(), request));
    }

    @PatchMapping("/{id}")
    public InventoryItemResponse updateItem(@PathVariable Long id,
            @Valid @RequestBody UpdateInventoryItemRequest request) {
        return inventoryItemService.updateItem(currentUserId(), id, request);
    }

    @PatchMapping("/{id}/quantity")
    public QuantityResponse adjustQuantity(@PathVariable Long id, @Valid @RequestBody QuantityAdjustRequest request) {
        return inventoryItemService.adjustQuantity(currentUserId(), id, request);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteItem(@PathVariable Long id) {
        inventoryItemService.deleteItem(currentUserId(), id);
        return ResponseEntity.noContent().build();
    }
}

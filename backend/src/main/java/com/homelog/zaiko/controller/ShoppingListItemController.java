package com.homelog.zaiko.controller;

import static com.homelog.common.security.CurrentUserProvider.currentUserId;

import com.homelog.zaiko.dto.request.CreateShoppingListItemRequest;
import com.homelog.zaiko.dto.request.ProcessPurchaseRequest;
import com.homelog.zaiko.dto.response.ProcessPurchaseResponse;
import com.homelog.zaiko.dto.response.ShoppingListItemResponse;
import com.homelog.zaiko.service.ShoppingListItemService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/shopping-list-items")
public class ShoppingListItemController {

    private final ShoppingListItemService shoppingListItemService;

    public ShoppingListItemController(ShoppingListItemService shoppingListItemService) {
        this.shoppingListItemService = shoppingListItemService;
    }

    @GetMapping
    public List<ShoppingListItemResponse> listItems(
            @RequestParam(name = "sort", required = false) String sort) {
        return shoppingListItemService.listItems(currentUserId(), sort);
    }

    @PostMapping
    public ResponseEntity<ShoppingListItemResponse> createManualItem(
            @Valid @RequestBody CreateShoppingListItemRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(shoppingListItemService.createManualItem(currentUserId(), request));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteItem(@PathVariable Long id) {
        shoppingListItemService.deleteItem(currentUserId(), id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/update")
    public ProcessPurchaseResponse processPurchase(@Valid @RequestBody ProcessPurchaseRequest request) {
        return shoppingListItemService.processPurchase(currentUserId(), request);
    }
}

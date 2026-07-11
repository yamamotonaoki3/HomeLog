package com.homelog.zaiko.dto.request;

import jakarta.validation.constraints.NotNull;

public record CreateShoppingListItemRequest(
        @NotNull Long inventoryItemId) {
}

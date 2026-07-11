package com.homelog.zaiko.dto.response;

import java.math.BigDecimal;

public record ShoppingListItemResponse(
        Long id, Long inventoryItemId, String name, boolean isManual, boolean purchased,
        BigDecimal purchasedQuantity) {
}

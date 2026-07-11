package com.homelog.zaiko.dto.response;

import java.util.List;

public record ProcessPurchaseResponse(
        List<QuantityResponse> updatedInventoryItems, List<Long> removedShoppingListItemIds) {
}

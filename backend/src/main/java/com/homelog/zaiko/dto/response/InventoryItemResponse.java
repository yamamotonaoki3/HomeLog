package com.homelog.zaiko.dto.response;

import java.math.BigDecimal;

public record InventoryItemResponse(
        Long id, String name, Long categoryId, Long storeId, BigDecimal quantity, BigDecimal threshold) {
}

package com.homelog.zaiko.dto.request;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

public record CreateInventoryItemRequest(
        @NotBlank @Size(max = 50) String name,
        @NotNull Long categoryId,
        Long storeId,
        @NotNull @DecimalMin(value = "0.0") @Digits(integer = 5, fraction = 1) BigDecimal quantity,
        @NotNull @DecimalMin(value = "0.0") @Digits(integer = 5, fraction = 1) BigDecimal threshold) {
}

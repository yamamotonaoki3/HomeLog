package com.homelog.zaiko.dto.request;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

public record PurchaseLineRequest(
        @NotNull Long id,
        @NotNull @DecimalMin(value = "0.0") @Digits(integer = 5, fraction = 1) BigDecimal purchasedQuantity) {
}

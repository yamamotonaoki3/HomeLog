package com.homelog.zaiko.dto.request;

import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

public record QuantityAdjustRequest(
        @NotNull @Digits(integer = 5, fraction = 1) BigDecimal delta) {
}

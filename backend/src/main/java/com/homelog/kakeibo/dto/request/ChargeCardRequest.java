package com.homelog.kakeibo.dto.request;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

public record ChargeCardRequest(
        @NotNull Long fromAccountId,
        @NotNull @Positive @Max(9_999_999_999L) Long amount) {
}

package com.homelog.kakeibo.dto.request;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

public record UpdateFixedCostRequest(
        @NotBlank @Size(max = 50) String name,
        @NotNull @Positive @Max(9_999_999_999L) Long amount,
        @NotNull @Min(1) @Max(31) Integer paymentDay,
        @NotNull Boolean personal,
        Boolean includeInHouseholdTotal,
        Long accountId,
        Long cardId) {
}

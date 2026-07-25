package com.homelog.kakeibo.dto.request;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

public record CreateExpenseRequest(
        @NotNull LocalDate expenseDate,
        @NotNull @Positive @Max(9_999_999_999L) Long amount,
        @NotBlank @Size(max = 100) String purpose,
        @NotNull Long categoryId,
        @Size(max = 255) String memo,
        Boolean includeInHouseholdTotal) {
}

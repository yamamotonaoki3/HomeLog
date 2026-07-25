package com.homelog.kakeibo.dto.response;

import java.math.BigDecimal;
import java.time.LocalDate;

public record ExpenseResponse(
        Long id,
        LocalDate expenseDate,
        BigDecimal amount,
        String purpose,
        Long categoryId,
        String memo,
        boolean includeInHouseholdTotal) {
}

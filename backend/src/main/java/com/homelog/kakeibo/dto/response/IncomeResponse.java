package com.homelog.kakeibo.dto.response;

import java.math.BigDecimal;
import java.time.LocalDate;

public record IncomeResponse(
        Long id,
        LocalDate incomeDate,
        BigDecimal amount,
        String content,
        Long categoryId,
        String memo) {
}

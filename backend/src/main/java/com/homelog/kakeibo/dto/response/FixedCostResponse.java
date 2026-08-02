package com.homelog.kakeibo.dto.response;

import java.math.BigDecimal;

public record FixedCostResponse(
        Long id,
        String name,
        BigDecimal amount,
        int paymentDay,
        boolean personal,
        boolean includeInHouseholdTotal,
        boolean editable,
        Long accountId,
        Long cardId) {
}

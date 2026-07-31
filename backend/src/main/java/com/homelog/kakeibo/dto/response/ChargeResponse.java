package com.homelog.kakeibo.dto.response;

import java.math.BigDecimal;
import java.time.LocalDateTime;

public record ChargeResponse(
        Long id,
        Long cardId,
        Long fromAccountId,
        BigDecimal amount,
        BigDecimal cardBalanceAfter,
        BigDecimal accountBalanceAfter,
        LocalDateTime createdAt) {
}

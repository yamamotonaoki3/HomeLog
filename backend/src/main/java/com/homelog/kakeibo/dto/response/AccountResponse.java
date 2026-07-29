package com.homelog.kakeibo.dto.response;

import java.math.BigDecimal;
import java.util.List;

public record AccountResponse(
        Long id,
        String name,
        String type,
        BigDecimal balance,
        List<CardResponse> cards) {
}

package com.homelog.kakeibo.dto.response;

import java.math.BigDecimal;

public record CardResponse(Long id, String name, Long accountId, String cardType, BigDecimal balance) {
}

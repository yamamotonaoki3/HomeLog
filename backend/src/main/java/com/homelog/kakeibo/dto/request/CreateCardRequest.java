package com.homelog.kakeibo.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record CreateCardRequest(
        @NotNull Long accountId,
        @NotBlank @Size(max = 50) String name,
        @NotBlank @Pattern(regexp = "credit|charge") String cardType) {
}

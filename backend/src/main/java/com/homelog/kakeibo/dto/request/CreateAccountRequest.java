package com.homelog.kakeibo.dto.request;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record CreateAccountRequest(
        @NotBlank @Size(max = 50) String name,
        @NotBlank @Size(max = 20) String type,
        @NotNull @Min(-9_999_999_999L) @Max(9_999_999_999L) Long balance) {
}

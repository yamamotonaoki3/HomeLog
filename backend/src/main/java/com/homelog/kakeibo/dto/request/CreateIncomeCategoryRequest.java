package com.homelog.kakeibo.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateIncomeCategoryRequest(
        @NotBlank @Size(max = 50) String name) {
}

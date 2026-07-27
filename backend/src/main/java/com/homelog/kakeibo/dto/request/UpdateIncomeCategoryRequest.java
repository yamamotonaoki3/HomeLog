package com.homelog.kakeibo.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpdateIncomeCategoryRequest(
        @NotBlank @Size(max = 50) String name) {
}

package com.homelog.kakeibo.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpdateAccountRequest(
        @NotBlank @Size(max = 50) String name,
        @NotBlank @Size(max = 20) String type) {
}

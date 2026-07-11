package com.homelog.zaiko.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateStoreRequest(
        @NotBlank @Size(max = 50) String name) {
}

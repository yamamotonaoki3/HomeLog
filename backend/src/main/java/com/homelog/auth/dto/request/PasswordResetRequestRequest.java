package com.homelog.auth.dto.request;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

public record PasswordResetRequestRequest(@NotBlank @Email String email) {
}

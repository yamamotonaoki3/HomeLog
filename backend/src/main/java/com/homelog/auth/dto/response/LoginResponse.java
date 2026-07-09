package com.homelog.auth.dto.response;

public record LoginResponse(String accessToken, String refreshToken, long expiresIn) {
}

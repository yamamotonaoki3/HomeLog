package com.homelog.auth.dto.response;

public record RefreshResponse(String accessToken, long expiresIn) {
}

package com.homelog.common.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import javax.crypto.SecretKey;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * アクセストークン（JWT）の発行・検証を行うユーティリティ。
 * リフレッシュトークンはJWTではなく不透明なランダム文字列としてrefresh_tokensテーブルで管理する
 * （F01_auth.md 1-1章参照）。
 */
@Component
public class JwtUtil {

    private final SecretKey signingKey;
    private final long accessExpirationMillis;

    public JwtUtil(@Value("${jwt.secret}") String secret,
            @Value("${jwt.access-expiration}") long accessExpirationMillis) {
        this.signingKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.accessExpirationMillis = accessExpirationMillis;
    }

    public String generateAccessToken(Long userId) {
        Date now = new Date();
        Date expiry = new Date(now.getTime() + accessExpirationMillis);
        return Jwts.builder()
                .subject(String.valueOf(userId))
                .issuedAt(now)
                .expiration(expiry)
                .signWith(signingKey)
                .compact();
    }

    public long getAccessExpirationSeconds() {
        return accessExpirationMillis / 1000;
    }

    /**
     * トークンを検証してユーザーIDを取り出す。無効・期限切れの場合はJwtExceptionをスローする。
     */
    public Long extractUserId(String token) throws JwtException {
        Claims claims = Jwts.parser()
                .verifyWith(signingKey)
                .build()
                .parseSignedClaims(token)
                .getPayload();
        return Long.valueOf(claims.getSubject());
    }
}

package com.homelog.common.security;

import org.springframework.security.core.context.SecurityContextHolder;

public final class CurrentUserProvider {

    private CurrentUserProvider() {
    }

    // JwtAuthenticationFilterがSecurityContextHolderにユーザーIDを設定済みであることを前提とする
    public static Long currentUserId() {
        return (Long) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
    }
}

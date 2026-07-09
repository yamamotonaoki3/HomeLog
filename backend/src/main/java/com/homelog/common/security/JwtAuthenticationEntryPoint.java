package com.homelog.common.security;

import com.homelog.common.constant.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.stereotype.Component;

/**
 * トークンが無い・無効・期限切れの場合に401（common-notes.md 10章）を共通形式で返す。
 */
@Component
public class JwtAuthenticationEntryPoint implements AuthenticationEntryPoint {

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response,
            AuthenticationException authException) throws IOException {
        response.setStatus(HttpStatus.UNAUTHORIZED.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        String body = "{\"code\":\"" + ErrorCode.UNAUTHORIZED.name() + "\",\"message\":\"認証が必要です\",\"details\":[]}";
        response.getWriter().write(body);
    }
}

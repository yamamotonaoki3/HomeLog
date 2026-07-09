package com.homelog.auth.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homelog.auth.dto.request.LoginRequest;
import com.homelog.auth.dto.request.PasswordResetConfirmRequest;
import com.homelog.auth.dto.request.PasswordResetRequestRequest;
import com.homelog.auth.dto.request.RefreshRequest;
import com.homelog.auth.dto.request.RegisterRequest;
import com.homelog.auth.dto.response.LoginResponse;
import com.homelog.auth.dto.response.MessageResponse;
import com.homelog.auth.dto.response.RefreshResponse;
import com.homelog.auth.dto.response.RegisterResponse;
import com.homelog.auth.service.AuthService;
import com.homelog.common.exception.DuplicateResourceException;
import com.homelog.common.exception.UnauthorizedException;
import com.homelog.common.security.JwtUtil;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.Test;
import org.mockito.Answers;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

// このテストはリクエスト/レスポンスの検証が目的のため、認証フィルタ（JwtAuthenticationFilter等）は無効化する
@WebMvcTest(AuthController.class)
@AutoConfigureMockMvc(addFilters = false)
class AuthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    // リクエストボディの組み立てのみに使うため、Spring管理のBeanではなく素のObjectMapperで足りる
    private final ObjectMapper objectMapper = new ObjectMapper();

    @MockitoBean
    private AuthService authService;

    // JwtAuthenticationFilterはFilterとしてWebMvcTestのコンポーネントスキャン対象になるため、
    // その依存先のJwtUtilをモックしてBean生成エラーを避ける（addFilters=falseで実行自体はスキップされる）
    @MockitoBean
    private JwtUtil jwtUtil;

    // @MapperScanが全MapperをsqlSessionFactory必須のBeanとして登録するため、Webスライステストでもダミーを用意する
    // @MapperScanで登録されるMapperFactoryBeanの初期化検証（getConfiguration()呼び出し）が
    // コンテキスト起動時に走るため、DEEP_STUBSでnullを返さないようにする
    @MockitoBean(answers = Answers.RETURNS_DEEP_STUBS)
    private SqlSessionFactory sqlSessionFactory;

    @Test
    void register_正常系は201() throws Exception {
        when(authService.register(any())).thenReturn(new RegisterResponse(1L, "taro@example.com", "太郎"));

        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new RegisterRequest("taro@example.com", "Passw0rd", "太郎"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.email").value("taro@example.com"));
    }

    @Test
    void register_パスワード強度不足は400() throws Exception {
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new RegisterRequest("taro@example.com", "weak", "太郎"))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void register_メール重複は409() throws Exception {
        when(authService.register(any())).thenThrow(new DuplicateResourceException("重複しています"));

        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new RegisterRequest("taro@example.com", "Passw0rd", "太郎"))))
                .andExpect(status().isConflict());
    }

    @Test
    void login_正常系は200() throws Exception {
        when(authService.login(any())).thenReturn(new LoginResponse("access", "refresh", 900));

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new LoginRequest("taro@example.com", "Passw0rd"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("access"));
    }

    @Test
    void login_認証失敗は401() throws Exception {
        when(authService.login(any())).thenThrow(new UnauthorizedException("認証失敗"));

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new LoginRequest("taro@example.com", "wrong"))))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void refresh_正常系は200() throws Exception {
        when(authService.refresh(any())).thenReturn(new RefreshResponse("new-access", 900));

        mockMvc.perform(post("/api/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new RefreshRequest("refresh-token"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("new-access"));
    }

    @Test
    void logout_正常系は204() throws Exception {
        mockMvc.perform(post("/api/auth/logout")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new RefreshRequest("refresh-token"))))
                .andExpect(status().isNoContent());
    }

    @Test
    void passwordResetRequest_正常系は200() throws Exception {
        when(authService.requestPasswordReset(any())).thenReturn(new MessageResponse("送信しました"));

        mockMvc.perform(post("/api/auth/password-reset/request")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new PasswordResetRequestRequest("taro@example.com"))))
                .andExpect(status().isOk());
    }

    @Test
    void passwordResetConfirm_正常系は200() throws Exception {
        mockMvc.perform(post("/api/auth/password-reset/confirm")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new PasswordResetConfirmRequest("token", "NewPassw0rd"))))
                .andExpect(status().isOk());
    }
}

package com.homelog.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.homelog.auth.dto.request.LoginRequest;
import com.homelog.auth.dto.request.PasswordResetConfirmRequest;
import com.homelog.auth.dto.request.PasswordResetRequestRequest;
import com.homelog.auth.dto.request.RefreshRequest;
import com.homelog.auth.dto.request.RegisterRequest;
import com.homelog.auth.dto.response.LoginResponse;
import com.homelog.auth.dto.response.RefreshResponse;
import com.homelog.auth.dto.response.RegisterResponse;
import com.homelog.auth.entity.PasswordResetTokenEntity;
import com.homelog.auth.entity.RefreshTokenEntity;
import com.homelog.auth.entity.UserEntity;
import com.homelog.auth.mapper.PasswordResetTokenMapper;
import com.homelog.auth.mapper.RefreshTokenMapper;
import com.homelog.auth.mapper.UserMapper;
import com.homelog.common.exception.DuplicateResourceException;
import com.homelog.common.exception.InvalidTokenException;
import com.homelog.common.exception.UnauthorizedException;
import com.homelog.common.security.JwtUtil;
import java.time.LocalDateTime;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @Mock
    private UserMapper userMapper;
    @Mock
    private RefreshTokenMapper refreshTokenMapper;
    @Mock
    private PasswordResetTokenMapper passwordResetTokenMapper;
    @Mock
    private PasswordEncoder passwordEncoder;
    @Mock
    private JwtUtil jwtUtil;

    private AuthService authService;

    @BeforeEach
    void setUp() {
        authService = new AuthService(userMapper, refreshTokenMapper, passwordResetTokenMapper, passwordEncoder,
                jwtUtil);
        ReflectionTestUtils.setField(authService, "refreshExpirationMillis", 604800000L);
    }

    @Test
    void register_正常系() {
        when(userMapper.findByEmail("taro@example.com")).thenReturn(null);
        when(passwordEncoder.encode("Passw0rd")).thenReturn("hashed");

        RegisterResponse response = authService.register(
                new RegisterRequest("taro@example.com", "Passw0rd", "太郎"));

        assertThat(response.email()).isEqualTo("taro@example.com");
        assertThat(response.displayName()).isEqualTo("太郎");
        verify(userMapper).insert(any(UserEntity.class));
    }

    @Test
    void register_メール重複は例外() {
        UserEntity existing = new UserEntity();
        when(userMapper.findByEmail("taro@example.com")).thenReturn(existing);

        assertThatThrownBy(() -> authService.register(new RegisterRequest("taro@example.com", "Passw0rd", "太郎")))
                .isInstanceOf(DuplicateResourceException.class);
        verify(userMapper, never()).insert(any());
    }

    @Test
    void register_同時登録によるDB制約違反も重複として扱う() {
        when(userMapper.findByEmail("taro@example.com")).thenReturn(null);
        org.mockito.Mockito.doThrow(new org.springframework.dao.DuplicateKeyException("duplicate"))
                .when(userMapper).insert(any());

        assertThatThrownBy(() -> authService.register(new RegisterRequest("taro@example.com", "Passw0rd", "太郎")))
                .isInstanceOf(DuplicateResourceException.class);
    }

    @Test
    void login_正常系() {
        UserEntity user = userWith(1L, "taro@example.com", "hashed");
        when(userMapper.findByEmail("taro@example.com")).thenReturn(user);
        when(passwordEncoder.matches("Passw0rd", "hashed")).thenReturn(true);
        when(jwtUtil.generateAccessToken(1L)).thenReturn("access-token");
        when(jwtUtil.getAccessExpirationSeconds()).thenReturn(900L);

        LoginResponse response = authService.login(new LoginRequest("taro@example.com", "Passw0rd"));

        assertThat(response.accessToken()).isEqualTo("access-token");
        assertThat(response.refreshToken()).isNotBlank();
        assertThat(response.expiresIn()).isEqualTo(900L);
        verify(refreshTokenMapper).insert(any(RefreshTokenEntity.class));
    }

    @Test
    void login_ユーザーなしは401() {
        when(userMapper.findByEmail(anyString())).thenReturn(null);

        assertThatThrownBy(() -> authService.login(new LoginRequest("notfound@example.com", "Passw0rd")))
                .isInstanceOf(UnauthorizedException.class);
    }

    @Test
    void login_パスワード不一致は401() {
        UserEntity user = userWith(1L, "taro@example.com", "hashed");
        when(userMapper.findByEmail("taro@example.com")).thenReturn(user);
        when(passwordEncoder.matches("wrong", "hashed")).thenReturn(false);

        assertThatThrownBy(() -> authService.login(new LoginRequest("taro@example.com", "wrong")))
                .isInstanceOf(UnauthorizedException.class);
    }

    @Test
    void refresh_正常系() {
        RefreshTokenEntity entity = new RefreshTokenEntity();
        entity.setUserId(1L);
        entity.setExpiresAt(LocalDateTime.now().plusDays(1));
        when(refreshTokenMapper.findByTokenHash(anyString())).thenReturn(entity);
        when(jwtUtil.generateAccessToken(1L)).thenReturn("new-access-token");
        when(jwtUtil.getAccessExpirationSeconds()).thenReturn(900L);

        RefreshResponse response = authService.refresh(new RefreshRequest("some-refresh-token"));

        assertThat(response.accessToken()).isEqualTo("new-access-token");
    }

    @Test
    void refresh_トークンなしは401() {
        when(refreshTokenMapper.findByTokenHash(anyString())).thenReturn(null);

        assertThatThrownBy(() -> authService.refresh(new RefreshRequest("unknown-token")))
                .isInstanceOf(UnauthorizedException.class);
    }

    @Test
    void refresh_失効済みは401() {
        RefreshTokenEntity entity = new RefreshTokenEntity();
        entity.setUserId(1L);
        entity.setExpiresAt(LocalDateTime.now().plusDays(1));
        entity.setRevokedAt(LocalDateTime.now());
        when(refreshTokenMapper.findByTokenHash(anyString())).thenReturn(entity);

        assertThatThrownBy(() -> authService.refresh(new RefreshRequest("revoked-token")))
                .isInstanceOf(UnauthorizedException.class);
    }

    @Test
    void refresh_期限切れは401() {
        RefreshTokenEntity entity = new RefreshTokenEntity();
        entity.setUserId(1L);
        entity.setExpiresAt(LocalDateTime.now().minusSeconds(1));
        when(refreshTokenMapper.findByTokenHash(anyString())).thenReturn(entity);

        assertThatThrownBy(() -> authService.refresh(new RefreshRequest("expired-token")))
                .isInstanceOf(UnauthorizedException.class);
    }

    @Test
    void logout_トークンを失効させる() {
        authService.logout(new RefreshRequest("some-token"));

        verify(refreshTokenMapper).revokeByTokenHash(anyString(), any(LocalDateTime.class));
    }

    @Test
    void requestPasswordReset_存在するユーザーはトークンを発行() {
        UserEntity user = userWith(1L, "taro@example.com", "hashed");
        when(userMapper.findByEmail("taro@example.com")).thenReturn(user);

        authService.requestPasswordReset(new PasswordResetRequestRequest("taro@example.com"));

        verify(passwordResetTokenMapper).invalidateActiveByUserId(anyLong(), any(LocalDateTime.class));
        verify(passwordResetTokenMapper).insert(any(PasswordResetTokenEntity.class));
    }

    @Test
    void requestPasswordReset_存在しないユーザーでもトークン発行しない() {
        when(userMapper.findByEmail("notfound@example.com")).thenReturn(null);

        authService.requestPasswordReset(new PasswordResetRequestRequest("notfound@example.com"));

        verify(passwordResetTokenMapper, never()).insert(any());
    }

    @Test
    void confirmPasswordReset_正常系() {
        PasswordResetTokenEntity token = new PasswordResetTokenEntity();
        token.setId(10L);
        token.setUserId(1L);
        token.setExpiresAt(LocalDateTime.now().plusMinutes(10));
        when(passwordResetTokenMapper.findByTokenHash(anyString())).thenReturn(token);
        when(passwordResetTokenMapper.markUsed(eq(10L), any(LocalDateTime.class))).thenReturn(1);
        when(passwordEncoder.encode("NewPassw0rd")).thenReturn("new-hashed");

        authService.confirmPasswordReset(new PasswordResetConfirmRequest("reset-token", "NewPassw0rd"));

        verify(userMapper).updatePasswordHash(1L, "new-hashed");
        verify(passwordResetTokenMapper).markUsed(eq(10L), any(LocalDateTime.class));
    }

    @Test
    void confirmPasswordReset_同時消費で更新0件なら無効() {
        PasswordResetTokenEntity token = new PasswordResetTokenEntity();
        token.setId(10L);
        token.setUserId(1L);
        token.setExpiresAt(LocalDateTime.now().plusMinutes(10));
        when(passwordResetTokenMapper.findByTokenHash(anyString())).thenReturn(token);
        when(passwordResetTokenMapper.markUsed(eq(10L), any(LocalDateTime.class))).thenReturn(0);

        assertThatThrownBy(() -> authService.confirmPasswordReset(
                new PasswordResetConfirmRequest("raced-token", "NewPassw0rd")))
                .isInstanceOf(InvalidTokenException.class);
        verify(userMapper, never()).updatePasswordHash(any(), any());
    }

    @Test
    void confirmPasswordReset_トークンなしは無効() {
        when(passwordResetTokenMapper.findByTokenHash(anyString())).thenReturn(null);

        assertThatThrownBy(() -> authService.confirmPasswordReset(
                new PasswordResetConfirmRequest("unknown", "NewPassw0rd")))
                .isInstanceOf(InvalidTokenException.class);
    }

    @Test
    void confirmPasswordReset_使用済みは無効() {
        PasswordResetTokenEntity token = new PasswordResetTokenEntity();
        token.setId(10L);
        token.setUserId(1L);
        token.setExpiresAt(LocalDateTime.now().plusMinutes(10));
        token.setUsedAt(LocalDateTime.now());
        when(passwordResetTokenMapper.findByTokenHash(anyString())).thenReturn(token);

        assertThatThrownBy(() -> authService.confirmPasswordReset(
                new PasswordResetConfirmRequest("used-token", "NewPassw0rd")))
                .isInstanceOf(InvalidTokenException.class);
    }

    @Test
    void confirmPasswordReset_期限切れは無効() {
        PasswordResetTokenEntity token = new PasswordResetTokenEntity();
        token.setId(10L);
        token.setUserId(1L);
        token.setExpiresAt(LocalDateTime.now().minusMinutes(1));
        when(passwordResetTokenMapper.findByTokenHash(anyString())).thenReturn(token);

        assertThatThrownBy(() -> authService.confirmPasswordReset(
                new PasswordResetConfirmRequest("expired-token", "NewPassw0rd")))
                .isInstanceOf(InvalidTokenException.class);
    }

    private UserEntity userWith(Long id, String email, String passwordHash) {
        UserEntity user = new UserEntity();
        user.setId(id);
        user.setEmail(email);
        user.setPasswordHash(passwordHash);
        user.setDisplayName("太郎");
        return user;
    }
}

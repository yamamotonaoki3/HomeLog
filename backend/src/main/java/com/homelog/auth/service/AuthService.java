package com.homelog.auth.service;

import com.homelog.auth.dto.request.LoginRequest;
import com.homelog.auth.dto.request.PasswordResetConfirmRequest;
import com.homelog.auth.dto.request.PasswordResetRequestRequest;
import com.homelog.auth.dto.request.RefreshRequest;
import com.homelog.auth.dto.request.RegisterRequest;
import com.homelog.auth.dto.response.LoginResponse;
import com.homelog.auth.dto.response.MessageResponse;
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
import com.homelog.common.util.TokenGenerator;
import java.time.LocalDateTime;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private static final Logger LOGGER = LoggerFactory.getLogger(AuthService.class);

    private static final String PASSWORD_RESET_MESSAGE = "パスワードリセット用のメールを送信しました（該当アカウントが存在する場合）";
    private static final String INVALID_CREDENTIALS_MESSAGE = "メールアドレスまたはパスワードが正しくありません";
    private static final String INVALID_REFRESH_TOKEN_MESSAGE = "リフレッシュトークンが無効です";
    private static final String INVALID_RESET_TOKEN_MESSAGE = "トークンが無効か期限切れです";

    private final UserMapper userMapper;
    private final RefreshTokenMapper refreshTokenMapper;
    private final PasswordResetTokenMapper passwordResetTokenMapper;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;

    @Value("${jwt.refresh-expiration}")
    private long refreshExpirationMillis;

    // メール送信基盤（今後の検討事項、F01_auth.md 7章）が実装されるまでの暫定措置。
    // 本番相当の環境では有効化しないこと（application.yml以外では未設定＝falseとする）。
    @Value("${app.password-reset.log-token-enabled:false}")
    private boolean logResetTokenEnabled;

    public AuthService(UserMapper userMapper, RefreshTokenMapper refreshTokenMapper,
            PasswordResetTokenMapper passwordResetTokenMapper, PasswordEncoder passwordEncoder, JwtUtil jwtUtil) {
        this.userMapper = userMapper;
        this.refreshTokenMapper = refreshTokenMapper;
        this.passwordResetTokenMapper = passwordResetTokenMapper;
        this.passwordEncoder = passwordEncoder;
        this.jwtUtil = jwtUtil;
    }

    @Transactional
    public RegisterResponse register(RegisterRequest request) {
        if (userMapper.findByEmail(request.email()) != null) {
            throw new DuplicateResourceException("このメールアドレスは既に登録されています");
        }
        UserEntity user = new UserEntity();
        user.setEmail(request.email());
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setDisplayName(request.displayName());
        user.setCreatedAt(LocalDateTime.now());
        try {
            userMapper.insert(user);
        } catch (DuplicateKeyException ex) {
            // 事前チェックとinsertの間で同一メールが同時登録された場合の競合を防ぐ（DBのUNIQUE制約を最終防衛線とする）
            throw new DuplicateResourceException("このメールアドレスは既に登録されています");
        }
        return new RegisterResponse(user.getId(), user.getEmail(), user.getDisplayName());
    }

    @Transactional
    public LoginResponse login(LoginRequest request) {
        UserEntity user = userMapper.findByEmail(request.email());
        if (user == null || !passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
        }
        String accessToken = jwtUtil.generateAccessToken(user.getId());
        String refreshToken = TokenGenerator.generateOpaqueToken();
        RefreshTokenEntity entity = new RefreshTokenEntity();
        entity.setUserId(user.getId());
        entity.setTokenHash(TokenGenerator.hash(refreshToken));
        entity.setExpiresAt(LocalDateTime.now().plusSeconds(refreshExpirationMillis / 1000));
        refreshTokenMapper.insert(entity);
        return new LoginResponse(accessToken, refreshToken, jwtUtil.getAccessExpirationSeconds());
    }

    @Transactional
    public RefreshResponse refresh(RefreshRequest request) {
        RefreshTokenEntity entity = refreshTokenMapper.findByTokenHash(TokenGenerator.hash(request.refreshToken()));
        if (entity == null || entity.getRevokedAt() != null || entity.getExpiresAt().isBefore(LocalDateTime.now())) {
            throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
        }
        String accessToken = jwtUtil.generateAccessToken(entity.getUserId());
        return new RefreshResponse(accessToken, jwtUtil.getAccessExpirationSeconds());
    }

    @Transactional
    public void logout(RefreshRequest request) {
        refreshTokenMapper.revokeByTokenHash(TokenGenerator.hash(request.refreshToken()), LocalDateTime.now());
    }

    @Transactional
    public MessageResponse requestPasswordReset(PasswordResetRequestRequest request) {
        UserEntity user = userMapper.findByEmail(request.email());
        if (user != null) {
            passwordResetTokenMapper.invalidateActiveByUserId(user.getId(), LocalDateTime.now());
            String rawToken = TokenGenerator.generateOpaqueToken();
            PasswordResetTokenEntity entity = new PasswordResetTokenEntity();
            entity.setUserId(user.getId());
            entity.setTokenHash(TokenGenerator.hash(rawToken));
            entity.setExpiresAt(LocalDateTime.now().plusMinutes(30));
            passwordResetTokenMapper.insert(entity);
            // メール送信基盤が実装されるまでの暫定措置。ログへのトークン出力はapp.password-reset.log-token-enabled
            // がtrueの環境（ローカル開発専用）でのみ行い、共有環境・本番環境では出力しない。
            if (logResetTokenEnabled) {
                LOGGER.warn("[開発用] パスワードリセットトークンを発行しました。userId={}, token={}", user.getId(), rawToken);
            } else {
                LOGGER.info("パスワードリセットトークンを発行しました。userId={}", user.getId());
            }
        }
        // メールアドレスの存在有無に関わらず同一メッセージを返す（F01_auth.md参照）
        return new MessageResponse(PASSWORD_RESET_MESSAGE);
    }

    @Transactional
    public void confirmPasswordReset(PasswordResetConfirmRequest request) {
        PasswordResetTokenEntity entity = passwordResetTokenMapper.findByTokenHash(
                TokenGenerator.hash(request.token()));
        if (entity == null || entity.getUsedAt() != null || entity.getExpiresAt().isBefore(LocalDateTime.now())) {
            throw new InvalidTokenException(INVALID_RESET_TOKEN_MESSAGE);
        }
        // used_atがNULLの行のみを対象に更新するため、同時に同じトークンが使われた場合は
        // どちらか一方のみ更新件数1件になる（二重消費の防止）
        int updated = passwordResetTokenMapper.markUsed(entity.getId(), LocalDateTime.now());
        if (updated == 0) {
            throw new InvalidTokenException(INVALID_RESET_TOKEN_MESSAGE);
        }
        userMapper.updatePasswordHash(entity.getUserId(), passwordEncoder.encode(request.newPassword()));
    }
}

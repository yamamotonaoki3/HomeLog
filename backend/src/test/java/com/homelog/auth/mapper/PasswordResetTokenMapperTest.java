package com.homelog.auth.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.homelog.auth.entity.PasswordResetTokenEntity;
import com.homelog.auth.entity.UserEntity;
import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class PasswordResetTokenMapperTest {

    @Autowired
    private PasswordResetTokenMapper passwordResetTokenMapper;

    @Autowired
    private UserMapper userMapper;

    @Test
    void insertAndFindByTokenHash_正常系() {
        Long userId = createUser();
        PasswordResetTokenEntity token = new PasswordResetTokenEntity();
        token.setUserId(userId);
        token.setTokenHash("reset-hash-1");
        token.setExpiresAt(LocalDateTime.now().plusMinutes(30));

        passwordResetTokenMapper.insert(token);

        PasswordResetTokenEntity found = passwordResetTokenMapper.findByTokenHash("reset-hash-1");
        assertThat(found).isNotNull();
        assertThat(found.getUsedAt()).isNull();
    }

    @Test
    void markUsed_使用日時が設定される() {
        Long userId = createUser();
        PasswordResetTokenEntity token = new PasswordResetTokenEntity();
        token.setUserId(userId);
        token.setTokenHash("reset-hash-2");
        token.setExpiresAt(LocalDateTime.now().plusMinutes(30));
        passwordResetTokenMapper.insert(token);

        int updated = passwordResetTokenMapper.markUsed(token.getId(), LocalDateTime.now());

        assertThat(updated).isEqualTo(1);
        PasswordResetTokenEntity found = passwordResetTokenMapper.findByTokenHash("reset-hash-2");
        assertThat(found.getUsedAt()).isNotNull();
    }

    @Test
    void markUsed_使用済みトークンは再度更新できない() {
        Long userId = createUser();
        PasswordResetTokenEntity token = new PasswordResetTokenEntity();
        token.setUserId(userId);
        token.setTokenHash("reset-hash-3");
        token.setExpiresAt(LocalDateTime.now().plusMinutes(30));
        passwordResetTokenMapper.insert(token);
        passwordResetTokenMapper.markUsed(token.getId(), LocalDateTime.now());

        int secondUpdate = passwordResetTokenMapper.markUsed(token.getId(), LocalDateTime.now());

        assertThat(secondUpdate).isEqualTo(0);
    }

    @Test
    void invalidateActiveByUserId_未使用トークンが無効化される() {
        Long userId = createUser();
        PasswordResetTokenEntity oldToken = new PasswordResetTokenEntity();
        oldToken.setUserId(userId);
        oldToken.setTokenHash("reset-hash-old");
        oldToken.setExpiresAt(LocalDateTime.now().plusMinutes(30));
        passwordResetTokenMapper.insert(oldToken);

        passwordResetTokenMapper.invalidateActiveByUserId(userId, LocalDateTime.now());

        PasswordResetTokenEntity found = passwordResetTokenMapper.findByTokenHash("reset-hash-old");
        assertThat(found.getUsedAt()).isNotNull();
    }

    private Long createUser() {
        UserEntity user = new UserEntity();
        user.setEmail("reset-" + System.nanoTime() + "@example.com");
        user.setPasswordHash("hash");
        user.setDisplayName("太郎");
        user.setCreatedAt(LocalDateTime.now());
        userMapper.insert(user);
        return user.getId();
    }
}

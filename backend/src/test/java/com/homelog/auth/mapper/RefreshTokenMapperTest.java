package com.homelog.auth.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.homelog.auth.entity.RefreshTokenEntity;
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
class RefreshTokenMapperTest {

    @Autowired
    private RefreshTokenMapper refreshTokenMapper;

    @Autowired
    private UserMapper userMapper;

    @Test
    void insertAndFindByTokenHash_正常系() {
        Long userId = createUser();
        RefreshTokenEntity token = new RefreshTokenEntity();
        token.setUserId(userId);
        token.setTokenHash("hash-1");
        token.setExpiresAt(LocalDateTime.now().plusDays(7));

        refreshTokenMapper.insert(token);

        RefreshTokenEntity found = refreshTokenMapper.findByTokenHash("hash-1");
        assertThat(found).isNotNull();
        assertThat(found.getUserId()).isEqualTo(userId);
        assertThat(found.getRevokedAt()).isNull();
    }

    @Test
    void revokeByTokenHash_失効日時が設定される() {
        Long userId = createUser();
        RefreshTokenEntity token = new RefreshTokenEntity();
        token.setUserId(userId);
        token.setTokenHash("hash-2");
        token.setExpiresAt(LocalDateTime.now().plusDays(7));
        refreshTokenMapper.insert(token);

        refreshTokenMapper.revokeByTokenHash("hash-2", LocalDateTime.now());

        RefreshTokenEntity found = refreshTokenMapper.findByTokenHash("hash-2");
        assertThat(found.getRevokedAt()).isNotNull();
    }

    private Long createUser() {
        UserEntity user = new UserEntity();
        user.setEmail("refresh-" + System.nanoTime() + "@example.com");
        user.setPasswordHash("hash");
        user.setDisplayName("太郎");
        user.setCreatedAt(LocalDateTime.now());
        userMapper.insert(user);
        return user.getId();
    }
}

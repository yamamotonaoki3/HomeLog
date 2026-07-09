package com.homelog.auth.mapper;

import static org.assertj.core.api.Assertions.assertThat;

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
class UserMapperTest {

    @Autowired
    private UserMapper userMapper;

    @Test
    void insertAndFindByEmail_正常系() {
        UserEntity user = newUser("taro@example.com");

        userMapper.insert(user);

        assertThat(user.getId()).isNotNull();
        UserEntity found = userMapper.findByEmail("taro@example.com");
        assertThat(found).isNotNull();
        assertThat(found.getDisplayName()).isEqualTo("太郎");
    }

    @Test
    void findByEmail_該当なしはnullを返す() {
        UserEntity found = userMapper.findByEmail("notfound@example.com");

        assertThat(found).isNull();
    }

    @Test
    void findById_正常系() {
        UserEntity user = newUser("hanako@example.com");
        userMapper.insert(user);

        UserEntity found = userMapper.findById(user.getId());

        assertThat(found.getEmail()).isEqualTo("hanako@example.com");
    }

    @Test
    void updatePasswordHash_正常系() {
        UserEntity user = newUser("update@example.com");
        userMapper.insert(user);

        userMapper.updatePasswordHash(user.getId(), "new-hash");

        UserEntity found = userMapper.findById(user.getId());
        assertThat(found.getPasswordHash()).isEqualTo("new-hash");
    }

    private UserEntity newUser(String email) {
        UserEntity user = new UserEntity();
        user.setEmail(email);
        user.setPasswordHash("hash");
        user.setDisplayName("太郎");
        user.setCreatedAt(LocalDateTime.now());
        return user;
    }
}

package com.homelog.auth.mapper;

import com.homelog.auth.entity.RefreshTokenEntity;
import java.time.LocalDateTime;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface RefreshTokenMapper {

    void insert(RefreshTokenEntity token);

    RefreshTokenEntity findByTokenHash(String tokenHash);

    void revokeByTokenHash(@Param("tokenHash") String tokenHash, @Param("revokedAt") LocalDateTime revokedAt);
}

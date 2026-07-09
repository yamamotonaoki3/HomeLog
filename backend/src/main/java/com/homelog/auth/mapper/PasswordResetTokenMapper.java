package com.homelog.auth.mapper;

import com.homelog.auth.entity.PasswordResetTokenEntity;
import java.time.LocalDateTime;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface PasswordResetTokenMapper {

    void insert(PasswordResetTokenEntity token);

    PasswordResetTokenEntity findByTokenHash(String tokenHash);

    /**
     * used_atがまだNULLの場合のみ使用済みにする（同時実行時の二重消費防止）。更新件数を返す。
     */
    int markUsed(@Param("id") Long id, @Param("usedAt") LocalDateTime usedAt);

    void invalidateActiveByUserId(@Param("userId") Long userId, @Param("usedAt") LocalDateTime usedAt);
}

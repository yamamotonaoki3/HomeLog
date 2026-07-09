package com.homelog.auth.mapper;

import com.homelog.auth.entity.UserEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface UserMapper {

    void insert(UserEntity user);

    UserEntity findByEmail(String email);

    UserEntity findById(Long id);

    void updatePasswordHash(@Param("id") Long id, @Param("passwordHash") String passwordHash);
}

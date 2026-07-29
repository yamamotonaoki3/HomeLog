package com.homelog.kakeibo.mapper;

import com.homelog.kakeibo.entity.CardEntity;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface CardMapper {

    void insert(CardEntity card);

    CardEntity findById(long id);

    List<CardEntity> findByAccountId(long accountId);

    void update(@Param("id") long id, @Param("name") String name);

    void delete(long id);
}

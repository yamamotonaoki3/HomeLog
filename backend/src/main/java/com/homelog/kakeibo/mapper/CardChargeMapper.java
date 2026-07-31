package com.homelog.kakeibo.mapper;

import com.homelog.kakeibo.entity.CardChargeEntity;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface CardChargeMapper {

    void insert(CardChargeEntity charge);

    int countByCardId(long cardId);

    int countByFromAccountId(long fromAccountId);
}

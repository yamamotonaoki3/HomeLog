package com.homelog.kakeibo.mapper;

import com.homelog.kakeibo.entity.AccountEntity;
import java.math.BigDecimal;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface AccountMapper {

    void insert(AccountEntity account);

    AccountEntity findById(long id);

    AccountEntity lockById(long id);

    List<AccountEntity> findByHouseholdIdAndOwnerUserId(@Param("householdId") long householdId,
            @Param("ownerUserId") long ownerUserId);

    void update(@Param("id") long id, @Param("name") String name, @Param("type") String type);

    void updateBalance(@Param("id") long id, @Param("balance") BigDecimal balance);

    void delete(long id);
}

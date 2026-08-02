package com.homelog.kakeibo.mapper;

import com.homelog.kakeibo.entity.FixedCostEntity;
import java.math.BigDecimal;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface FixedCostMapper {

    void insert(FixedCostEntity fixedCost);

    FixedCostEntity findById(long id);

    List<FixedCostEntity> findVisibleByHouseholdIdAndUserId(@Param("householdId") long householdId,
            @Param("userId") long userId);

    void update(@Param("id") long id, @Param("name") String name, @Param("amount") BigDecimal amount,
            @Param("paymentDay") int paymentDay, @Param("ownerUserId") Long ownerUserId,
            @Param("includeInHouseholdTotal") boolean includeInHouseholdTotal);

    void delete(long id);
}

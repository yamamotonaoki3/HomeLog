package com.homelog.kakeibo.mapper;

import com.homelog.kakeibo.entity.IncomeEntity;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface IncomeMapper {

    void insert(IncomeEntity income);

    IncomeEntity findById(long id);

    List<IncomeEntity> findByEarnerUserId(@Param("householdId") long householdId,
            @Param("earnerUserId") long earnerUserId,
            @Param("categoryId") Long categoryId);

    int countByCategoryId(long categoryId);
}

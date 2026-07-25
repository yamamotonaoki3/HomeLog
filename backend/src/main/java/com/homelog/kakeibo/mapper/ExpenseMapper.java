package com.homelog.kakeibo.mapper;

import com.homelog.kakeibo.entity.ExpenseEntity;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface ExpenseMapper {

    void insert(ExpenseEntity expense);

    ExpenseEntity findById(long id);

    List<ExpenseEntity> findByPayerUserId(@Param("payerUserId") long payerUserId,
            @Param("categoryId") Long categoryId);

    int countByCategoryId(long categoryId);
}

package com.homelog.kakeibo.mapper;

import com.homelog.kakeibo.entity.IncomeCategoryEntity;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface IncomeCategoryMapper {

    void insert(IncomeCategoryEntity category);

    IncomeCategoryEntity findById(long id);

    List<IncomeCategoryEntity> findByHouseholdId(long householdId);

    void update(@Param("id") long id, @Param("name") String name);

    void delete(long id);
}

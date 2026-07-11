package com.homelog.zaiko.mapper;

import com.homelog.zaiko.entity.ZaikoCategoryEntity;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface ZaikoCategoryMapper {

    void insert(ZaikoCategoryEntity category);

    ZaikoCategoryEntity findById(long id);

    List<ZaikoCategoryEntity> findByHouseholdId(long householdId);

    void update(@Param("id") long id, @Param("name") String name);

    void delete(long id);
}

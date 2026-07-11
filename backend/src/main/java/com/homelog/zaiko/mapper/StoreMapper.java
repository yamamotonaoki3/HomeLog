package com.homelog.zaiko.mapper;

import com.homelog.zaiko.entity.StoreEntity;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface StoreMapper {

    void insert(StoreEntity store);

    StoreEntity findById(long id);

    List<StoreEntity> findByHouseholdId(long householdId);

    void update(@Param("id") long id, @Param("name") String name);

    void delete(long id);
}

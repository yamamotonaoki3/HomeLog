package com.homelog.kakeibo.mapper;

import com.homelog.kakeibo.entity.KakeiboCategoryEntity;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface KakeiboCategoryMapper {

    void insert(KakeiboCategoryEntity category);

    KakeiboCategoryEntity findById(long id);

    List<KakeiboCategoryEntity> findByHouseholdId(long householdId);

    void update(@Param("id") long id, @Param("name") String name);

    void delete(long id);
}

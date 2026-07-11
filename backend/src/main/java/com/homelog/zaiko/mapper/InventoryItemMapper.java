package com.homelog.zaiko.mapper;

import com.homelog.zaiko.entity.InventoryItemEntity;
import java.math.BigDecimal;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface InventoryItemMapper {

    void insert(InventoryItemEntity item);

    InventoryItemEntity findById(long id);

    List<InventoryItemEntity> findByHouseholdId(long householdId);

    void update(@Param("id") long id, @Param("name") String name, @Param("categoryId") long categoryId,
            @Param("storeId") Long storeId, @Param("threshold") BigDecimal threshold);

    int updateQuantity(@Param("id") long id, @Param("delta") BigDecimal delta);

    void delete(long id);

    int countByCategoryId(long categoryId);

    int countByStoreId(long storeId);

    int countBelowThreshold(long householdId);
}

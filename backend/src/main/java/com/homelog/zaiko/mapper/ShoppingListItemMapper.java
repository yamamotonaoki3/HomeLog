package com.homelog.zaiko.mapper;

import com.homelog.zaiko.entity.ShoppingListItemEntity;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface ShoppingListItemMapper {

    void insert(ShoppingListItemEntity item);

    ShoppingListItemEntity findById(long id);

    List<ShoppingListItemEntity> findByHouseholdId(@Param("householdId") long householdId, @Param("sort") String sort);

    int countByHouseholdId(long householdId);

    ShoppingListItemEntity findByInventoryItemIdAndManual(
            @Param("inventoryItemId") long inventoryItemId, @Param("isManual") boolean isManual);

    boolean existsByInventoryItemId(long inventoryItemId);

    void deleteByInventoryItemIdAndManual(
            @Param("inventoryItemId") long inventoryItemId, @Param("isManual") boolean isManual);

    void deleteByInventoryItemId(long inventoryItemId);

    void delete(long id);

    void resetPurchase(long id);
}

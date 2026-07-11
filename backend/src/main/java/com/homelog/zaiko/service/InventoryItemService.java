package com.homelog.zaiko.service;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.zaiko.dto.request.CreateInventoryItemRequest;
import com.homelog.zaiko.dto.request.QuantityAdjustRequest;
import com.homelog.zaiko.dto.request.UpdateInventoryItemRequest;
import com.homelog.zaiko.dto.response.InventoryItemResponse;
import com.homelog.zaiko.dto.response.QuantityResponse;
import com.homelog.zaiko.entity.InventoryItemEntity;
import com.homelog.zaiko.entity.StoreEntity;
import com.homelog.zaiko.entity.ZaikoCategoryEntity;
import com.homelog.zaiko.mapper.InventoryItemMapper;
import com.homelog.zaiko.mapper.StoreMapper;
import com.homelog.zaiko.mapper.ZaikoCategoryMapper;
import java.math.BigDecimal;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class InventoryItemService {

    private static final String NOT_FOUND_MESSAGE = "在庫アイテムが見つかりません";
    private static final String CATEGORY_NOT_FOUND_MESSAGE = "指定されたカテゴリーが見つかりません";
    private static final String STORE_NOT_FOUND_MESSAGE = "指定された店舗が見つかりません";
    private static final String QUANTITY_OUT_OF_RANGE_MESSAGE = "在庫個数が範囲外です";
    private static final String DECIMAL_SCALE_MESSAGE = "数量は小数点第一位までで入力してください";

    private final InventoryItemMapper inventoryItemMapper;
    private final ZaikoCategoryMapper zaikoCategoryMapper;
    private final StoreMapper storeMapper;
    private final HouseholdMemberMapper householdMemberMapper;

    public InventoryItemService(InventoryItemMapper inventoryItemMapper, ZaikoCategoryMapper zaikoCategoryMapper,
            StoreMapper storeMapper, HouseholdMemberMapper householdMemberMapper) {
        this.inventoryItemMapper = inventoryItemMapper;
        this.zaikoCategoryMapper = zaikoCategoryMapper;
        this.storeMapper = storeMapper;
        this.householdMemberMapper = householdMemberMapper;
    }

    public List<InventoryItemResponse> listItems(Long userId) {
        Long householdId = resolveHouseholdId(userId);
        return inventoryItemMapper.findByHouseholdId(householdId).stream().map(this::toResponse).toList();
    }

    public InventoryItemResponse createItem(Long userId, CreateInventoryItemRequest request) {
        Long householdId = resolveHouseholdId(userId);
        validateCategory(householdId, request.categoryId());
        validateStore(householdId, request.storeId());

        InventoryItemEntity item = new InventoryItemEntity();
        item.setHouseholdId(householdId);
        item.setName(request.name());
        item.setCategoryId(request.categoryId());
        item.setStoreId(request.storeId());
        item.setQuantity(scale(request.quantity()));
        item.setThreshold(scale(request.threshold()));
        inventoryItemMapper.insert(item);
        return toResponse(item);
    }

    public InventoryItemResponse updateItem(Long userId, Long itemId, UpdateInventoryItemRequest request) {
        Long householdId = resolveHouseholdId(userId);
        InventoryItemEntity item = findOwnedItem(householdId, itemId);
        validateCategory(householdId, request.categoryId());
        validateStore(householdId, request.storeId());

        BigDecimal threshold = scale(request.threshold());
        inventoryItemMapper.update(itemId, request.name(), request.categoryId(), request.storeId(), threshold);
        item.setName(request.name());
        item.setCategoryId(request.categoryId());
        item.setStoreId(request.storeId());
        item.setThreshold(threshold);
        return toResponse(item);
    }

    public QuantityResponse adjustQuantity(Long userId, Long itemId, QuantityAdjustRequest request) {
        Long householdId = resolveHouseholdId(userId);
        findOwnedItem(householdId, itemId);

        BigDecimal delta = scale(request.delta());
        int updatedRows = inventoryItemMapper.updateQuantity(itemId, delta);
        if (updatedRows == 0) {
            throw new BadRequestException(QUANTITY_OUT_OF_RANGE_MESSAGE);
        }
        InventoryItemEntity updatedItem = findOwnedItem(householdId, itemId);
        return new QuantityResponse(itemId, updatedItem.getQuantity());
    }

    public void deleteItem(Long userId, Long itemId) {
        Long householdId = resolveHouseholdId(userId);
        findOwnedItem(householdId, itemId);
        inventoryItemMapper.delete(itemId);
    }

    private void validateCategory(Long householdId, Long categoryId) {
        ZaikoCategoryEntity category = zaikoCategoryMapper.findById(categoryId);
        if (category == null || !category.getHouseholdId().equals(householdId)) {
            throw new BadRequestException(CATEGORY_NOT_FOUND_MESSAGE);
        }
    }

    private void validateStore(Long householdId, Long storeId) {
        if (storeId == null) {
            return;
        }
        StoreEntity store = storeMapper.findById(storeId);
        if (store == null || !store.getHouseholdId().equals(householdId)) {
            throw new BadRequestException(STORE_NOT_FOUND_MESSAGE);
        }
    }

    private InventoryItemEntity findOwnedItem(Long householdId, Long itemId) {
        InventoryItemEntity item = inventoryItemMapper.findById(itemId);
        if (item == null || !item.getHouseholdId().equals(householdId)) {
            throw new ResourceNotFoundException(NOT_FOUND_MESSAGE);
        }
        return item;
    }

    private Long resolveHouseholdId(Long userId) {
        var member = householdMemberMapper.findByUserId(userId);
        if (member == null) {
            throw new ResourceNotFoundException("世帯グループが見つかりません");
        }
        return member.getHouseholdId();
    }

    private BigDecimal scale(BigDecimal value) {
        if (value.scale() > 1) {
            throw new BadRequestException(DECIMAL_SCALE_MESSAGE);
        }
        return value;
    }

    private InventoryItemResponse toResponse(InventoryItemEntity item) {
        return new InventoryItemResponse(item.getId(), item.getName(), item.getCategoryId(), item.getStoreId(),
                item.getQuantity(), item.getThreshold());
    }
}

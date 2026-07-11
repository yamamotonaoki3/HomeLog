package com.homelog.zaiko.service;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.zaiko.dto.request.CreateStoreRequest;
import com.homelog.zaiko.dto.request.UpdateStoreRequest;
import com.homelog.zaiko.dto.response.StoreResponse;
import com.homelog.zaiko.entity.StoreEntity;
import com.homelog.zaiko.mapper.InventoryItemMapper;
import com.homelog.zaiko.mapper.StoreMapper;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class StoreService {

    private static final String NOT_FOUND_MESSAGE = "店舗が見つかりません";
    private static final String IN_USE_MESSAGE = "使用中の店舗は削除できません";

    private final StoreMapper storeMapper;
    private final InventoryItemMapper inventoryItemMapper;
    private final HouseholdMemberMapper householdMemberMapper;

    public StoreService(StoreMapper storeMapper, InventoryItemMapper inventoryItemMapper,
            HouseholdMemberMapper householdMemberMapper) {
        this.storeMapper = storeMapper;
        this.inventoryItemMapper = inventoryItemMapper;
        this.householdMemberMapper = householdMemberMapper;
    }

    public List<StoreResponse> listStores(Long userId) {
        Long householdId = resolveHouseholdId(userId);
        return storeMapper.findByHouseholdId(householdId).stream().map(this::toResponse).toList();
    }

    public StoreResponse createStore(Long userId, CreateStoreRequest request) {
        Long householdId = resolveHouseholdId(userId);
        StoreEntity store = new StoreEntity();
        store.setHouseholdId(householdId);
        store.setName(request.name());
        storeMapper.insert(store);
        return toResponse(store);
    }

    public StoreResponse updateStore(Long userId, Long storeId, UpdateStoreRequest request) {
        Long householdId = resolveHouseholdId(userId);
        StoreEntity store = findOwnedStore(householdId, storeId);
        storeMapper.update(storeId, request.name());
        store.setName(request.name());
        return toResponse(store);
    }

    public void deleteStore(Long userId, Long storeId) {
        Long householdId = resolveHouseholdId(userId);
        findOwnedStore(householdId, storeId);
        if (inventoryItemMapper.countByStoreId(storeId) > 0) {
            throw new BadRequestException(IN_USE_MESSAGE);
        }
        storeMapper.delete(storeId);
    }

    private StoreEntity findOwnedStore(Long householdId, Long storeId) {
        StoreEntity store = storeMapper.findById(storeId);
        if (store == null || !store.getHouseholdId().equals(householdId)) {
            throw new ResourceNotFoundException(NOT_FOUND_MESSAGE);
        }
        return store;
    }

    private Long resolveHouseholdId(Long userId) {
        var member = householdMemberMapper.findByUserId(userId);
        if (member == null) {
            throw new ResourceNotFoundException("世帯グループが見つかりません");
        }
        return member.getHouseholdId();
    }

    private StoreResponse toResponse(StoreEntity store) {
        return new StoreResponse(store.getId(), store.getName());
    }
}

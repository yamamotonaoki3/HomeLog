package com.homelog.zaiko.service;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.zaiko.dto.request.CreateShoppingListItemRequest;
import com.homelog.zaiko.dto.request.ProcessPurchaseRequest;
import com.homelog.zaiko.dto.request.PurchaseLineRequest;
import com.homelog.zaiko.dto.response.ProcessPurchaseResponse;
import com.homelog.zaiko.dto.response.QuantityResponse;
import com.homelog.zaiko.dto.response.ShoppingListItemResponse;
import com.homelog.zaiko.entity.InventoryItemEntity;
import com.homelog.zaiko.entity.ShoppingListItemEntity;
import com.homelog.zaiko.mapper.InventoryItemMapper;
import com.homelog.zaiko.mapper.ShoppingListItemMapper;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ShoppingListItemService {

    private static final String NOT_FOUND_MESSAGE = "買い物リスト品目が見つかりません";
    private static final String ITEM_NOT_FOUND_MESSAGE = "指定された在庫アイテムが見つかりません";
    private static final String ALREADY_ADDED_MESSAGE = "既に買い物リストに追加されています";

    private final ShoppingListItemMapper shoppingListItemMapper;
    private final InventoryItemMapper inventoryItemMapper;
    private final HouseholdMemberMapper householdMemberMapper;

    public ShoppingListItemService(ShoppingListItemMapper shoppingListItemMapper,
            InventoryItemMapper inventoryItemMapper, HouseholdMemberMapper householdMemberMapper) {
        this.shoppingListItemMapper = shoppingListItemMapper;
        this.inventoryItemMapper = inventoryItemMapper;
        this.householdMemberMapper = householdMemberMapper;
    }

    public List<ShoppingListItemResponse> listItems(Long userId, String sortParam) {
        Long householdId = resolveHouseholdId(userId);
        String sort = normalizeSort(sortParam);
        return shoppingListItemMapper.findByHouseholdId(householdId, sort).stream()
                .map(this::toResponse)
                .toList();
    }

    public ShoppingListItemResponse createManualItem(Long userId, CreateShoppingListItemRequest request) {
        Long householdId = resolveHouseholdId(userId);
        InventoryItemEntity item = inventoryItemMapper.findById(request.inventoryItemId());
        if (item == null || !item.getHouseholdId().equals(householdId)) {
            throw new BadRequestException(ITEM_NOT_FOUND_MESSAGE);
        }
        if (shoppingListItemMapper.existsByInventoryItemId(request.inventoryItemId())) {
            throw new BadRequestException(ALREADY_ADDED_MESSAGE);
        }

        ShoppingListItemEntity entity = new ShoppingListItemEntity();
        entity.setHouseholdId(householdId);
        entity.setInventoryItemId(request.inventoryItemId());
        entity.setManual(true);
        entity.setPurchased(false);
        entity.setPurchasedQuantity(BigDecimal.ZERO);
        entity.setAddedAt(LocalDateTime.now());
        shoppingListItemMapper.insert(entity);
        return new ShoppingListItemResponse(entity.getId(), item.getId(), item.getName(), true, false,
                BigDecimal.ZERO);
    }

    public void deleteItem(Long userId, Long id) {
        Long householdId = resolveHouseholdId(userId);
        findOwnedItem(householdId, id);
        shoppingListItemMapper.delete(id);
    }

    @Transactional
    public ProcessPurchaseResponse processPurchase(Long userId, ProcessPurchaseRequest request) {
        Long householdId = resolveHouseholdId(userId);
        List<QuantityResponse> updatedInventoryItems = new ArrayList<>();
        List<Long> removedShoppingListItemIds = new ArrayList<>();

        for (PurchaseLineRequest line : request.items()) {
            ShoppingListItemEntity entity = findOwnedItem(householdId, line.id());
            int updatedRows = inventoryItemMapper.updateQuantity(entity.getInventoryItemId(), line.purchasedQuantity());
            if (updatedRows == 0) {
                throw new BadRequestException("在庫個数が範囲外です");
            }
            InventoryItemEntity item = inventoryItemMapper.findById(entity.getInventoryItemId());
            updatedInventoryItems.add(new QuantityResponse(item.getId(), item.getQuantity()));

            boolean stillBelowThreshold = item.getQuantity().compareTo(item.getThreshold()) < 0;
            if (entity.isManual() || !stillBelowThreshold) {
                shoppingListItemMapper.delete(entity.getId());
                removedShoppingListItemIds.add(entity.getId());
            } else {
                shoppingListItemMapper.resetPurchase(entity.getId());
            }
        }

        return new ProcessPurchaseResponse(updatedInventoryItems, removedShoppingListItemIds);
    }

    private ShoppingListItemEntity findOwnedItem(Long householdId, Long id) {
        ShoppingListItemEntity entity = shoppingListItemMapper.findById(id);
        if (entity == null || !entity.getHouseholdId().equals(householdId)) {
            throw new ResourceNotFoundException(NOT_FOUND_MESSAGE);
        }
        return entity;
    }

    private String normalizeSort(String sortParam) {
        if (sortParam == null) {
            return "NAME";
        }
        return switch (sortParam.toUpperCase(java.util.Locale.ROOT)) {
            case "CATEGORY" -> "CATEGORY";
            case "STORE" -> "STORE";
            default -> "NAME";
        };
    }

    private Long resolveHouseholdId(Long userId) {
        var member = householdMemberMapper.findByUserId(userId);
        if (member == null) {
            throw new ResourceNotFoundException("世帯グループが見つかりません");
        }
        return member.getHouseholdId();
    }

    private ShoppingListItemResponse toResponse(ShoppingListItemEntity entity) {
        return new ShoppingListItemResponse(entity.getId(), entity.getInventoryItemId(), entity.getName(),
                entity.isManual(), entity.isPurchased(), entity.getPurchasedQuantity());
    }
}

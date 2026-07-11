package com.homelog.dashboard.service;

import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.dashboard.dto.response.DashboardSummaryResponse;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.zaiko.mapper.InventoryItemMapper;
import com.homelog.zaiko.mapper.ShoppingListItemMapper;
import org.springframework.stereotype.Service;

@Service
public class DashboardService {

    private final HouseholdMemberMapper householdMemberMapper;
    private final ShoppingListItemMapper shoppingListItemMapper;
    private final InventoryItemMapper inventoryItemMapper;

    public DashboardService(HouseholdMemberMapper householdMemberMapper,
            ShoppingListItemMapper shoppingListItemMapper, InventoryItemMapper inventoryItemMapper) {
        this.householdMemberMapper = householdMemberMapper;
        this.shoppingListItemMapper = shoppingListItemMapper;
        this.inventoryItemMapper = inventoryItemMapper;
    }

    public DashboardSummaryResponse getSummary(Long userId) {
        Long householdId = resolveHouseholdId(userId);
        int shoppingListCount = shoppingListItemMapper.countByHouseholdId(householdId);
        int lowStockCount = inventoryItemMapper.countBelowThreshold(householdId);
        return new DashboardSummaryResponse(shoppingListCount, lowStockCount);
    }

    private Long resolveHouseholdId(Long userId) {
        var member = householdMemberMapper.findByUserId(userId);
        if (member == null) {
            throw new ResourceNotFoundException("世帯グループが見つかりません");
        }
        return member.getHouseholdId();
    }
}

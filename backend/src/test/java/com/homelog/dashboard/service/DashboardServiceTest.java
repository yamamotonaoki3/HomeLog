package com.homelog.dashboard.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.dashboard.dto.response.DashboardSummaryResponse;
import com.homelog.household.entity.HouseholdMemberEntity;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.zaiko.mapper.InventoryItemMapper;
import com.homelog.zaiko.mapper.ShoppingListItemMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class DashboardServiceTest {

    @Mock
    private HouseholdMemberMapper householdMemberMapper;
    @Mock
    private ShoppingListItemMapper shoppingListItemMapper;
    @Mock
    private InventoryItemMapper inventoryItemMapper;

    private DashboardService service() {
        return new DashboardService(householdMemberMapper, shoppingListItemMapper, inventoryItemMapper);
    }

    private HouseholdMemberEntity memberOf(long householdId) {
        HouseholdMemberEntity member = new HouseholdMemberEntity();
        member.setHouseholdId(householdId);
        return member;
    }

    @Test
    void getSummary_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(shoppingListItemMapper.countByHouseholdId(10L)).thenReturn(3);
        when(inventoryItemMapper.countBelowThreshold(10L)).thenReturn(2);

        DashboardSummaryResponse response = service().getSummary(1L);

        assertThat(response.shoppingListCount()).isEqualTo(3);
        assertThat(response.lowStockCount()).isEqualTo(2);
    }

    @Test
    void getSummary_未所属の場合は404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(null);

        assertThatThrownBy(() -> service().getSummary(1L)).isInstanceOf(ResourceNotFoundException.class);
    }
}

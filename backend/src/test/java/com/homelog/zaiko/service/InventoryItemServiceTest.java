package com.homelog.zaiko.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.entity.HouseholdMemberEntity;
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
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class InventoryItemServiceTest {

    @Mock
    private InventoryItemMapper inventoryItemMapper;
    @Mock
    private ZaikoCategoryMapper zaikoCategoryMapper;
    @Mock
    private StoreMapper storeMapper;
    @Mock
    private HouseholdMemberMapper householdMemberMapper;

    private InventoryItemService service() {
        return new InventoryItemService(inventoryItemMapper, zaikoCategoryMapper, storeMapper, householdMemberMapper);
    }

    private HouseholdMemberEntity memberOf(long householdId) {
        HouseholdMemberEntity member = new HouseholdMemberEntity();
        member.setHouseholdId(householdId);
        return member;
    }

    private ZaikoCategoryEntity categoryOf(long id, long householdId) {
        ZaikoCategoryEntity category = new ZaikoCategoryEntity();
        category.setId(id);
        category.setHouseholdId(householdId);
        return category;
    }

    @Test
    void listItems_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        InventoryItemEntity item = new InventoryItemEntity();
        item.setId(1L);
        item.setHouseholdId(10L);
        item.setName("牛乳");
        item.setQuantity(new BigDecimal("1.0"));
        item.setThreshold(new BigDecimal("0.5"));
        when(inventoryItemMapper.findByHouseholdId(10L)).thenReturn(List.of(item));

        List<InventoryItemResponse> response = service().listItems(1L);

        assertThat(response).hasSize(1);
        assertThat(response.get(0).name()).isEqualTo("牛乳");
    }

    @Test
    void createItem_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(zaikoCategoryMapper.findById(3L)).thenReturn(categoryOf(3L, 10L));

        InventoryItemResponse response = service().createItem(1L,
                new CreateInventoryItemRequest("牛乳", 3L, null, new BigDecimal("1.0"), new BigDecimal("0.5")));

        assertThat(response.name()).isEqualTo("牛乳");
        assertThat(response.quantity()).isEqualByComparingTo("1.0");
        verify(inventoryItemMapper).insert(any(InventoryItemEntity.class));
    }

    @Test
    void createItem_他世帯のカテゴリー指定は400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(zaikoCategoryMapper.findById(3L)).thenReturn(categoryOf(3L, 999L));

        assertThatThrownBy(() -> service().createItem(1L,
                new CreateInventoryItemRequest("牛乳", 3L, null, new BigDecimal("1.0"), new BigDecimal("0.5"))))
                .isInstanceOf(BadRequestException.class);
        verify(inventoryItemMapper, never()).insert(any());
    }

    @Test
    void createItem_他世帯の店舗指定は400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(zaikoCategoryMapper.findById(3L)).thenReturn(categoryOf(3L, 10L));
        StoreEntity store = new StoreEntity();
        store.setId(7L);
        store.setHouseholdId(999L);
        when(storeMapper.findById(7L)).thenReturn(store);

        assertThatThrownBy(() -> service().createItem(1L,
                new CreateInventoryItemRequest("牛乳", 3L, 7L, new BigDecimal("1.0"), new BigDecimal("0.5"))))
                .isInstanceOf(BadRequestException.class);
        verify(inventoryItemMapper, never()).insert(any());
    }

    @Test
    void updateItem_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        InventoryItemEntity item = new InventoryItemEntity();
        item.setId(5L);
        item.setHouseholdId(10L);
        when(inventoryItemMapper.findById(5L)).thenReturn(item);
        when(zaikoCategoryMapper.findById(3L)).thenReturn(categoryOf(3L, 10L));

        InventoryItemResponse response = service().updateItem(1L, 5L,
                new UpdateInventoryItemRequest("牛乳(改)", 3L, null, new BigDecimal("0.8")));

        assertThat(response.name()).isEqualTo("牛乳(改)");
        verify(inventoryItemMapper).update(5L, "牛乳(改)", 3L, null, new BigDecimal("0.8"));
    }

    @Test
    void updateItem_他世帯のアイテムは404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        InventoryItemEntity item = new InventoryItemEntity();
        item.setId(5L);
        item.setHouseholdId(999L);
        when(inventoryItemMapper.findById(5L)).thenReturn(item);

        assertThatThrownBy(() -> service().updateItem(1L, 5L,
                new UpdateInventoryItemRequest("牛乳(改)", 3L, null, new BigDecimal("0.8"))))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void adjustQuantity_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        InventoryItemEntity item = new InventoryItemEntity();
        item.setId(5L);
        item.setHouseholdId(10L);
        item.setQuantity(new BigDecimal("1.0"));
        InventoryItemEntity updatedItem = new InventoryItemEntity();
        updatedItem.setId(5L);
        updatedItem.setHouseholdId(10L);
        updatedItem.setQuantity(new BigDecimal("0.9"));
        when(inventoryItemMapper.findById(5L)).thenReturn(item, updatedItem);
        when(inventoryItemMapper.updateQuantity(5L, new BigDecimal("-0.1"))).thenReturn(1);

        QuantityResponse response = service().adjustQuantity(1L, 5L, new QuantityAdjustRequest(new BigDecimal("-0.1")));

        assertThat(response.quantity()).isEqualByComparingTo("0.9");
        verify(inventoryItemMapper).updateQuantity(5L, new BigDecimal("-0.1"));
    }

    @Test
    void adjustQuantity_0未満になる場合は400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        InventoryItemEntity item = new InventoryItemEntity();
        item.setId(5L);
        item.setHouseholdId(10L);
        item.setQuantity(new BigDecimal("0.5"));
        when(inventoryItemMapper.findById(5L)).thenReturn(item);
        when(inventoryItemMapper.updateQuantity(5L, new BigDecimal("-1.0"))).thenReturn(0);

        assertThatThrownBy(() -> service().adjustQuantity(1L, 5L, new QuantityAdjustRequest(new BigDecimal("-1.0"))))
                .isInstanceOf(BadRequestException.class);
        verify(inventoryItemMapper).updateQuantity(5L, new BigDecimal("-1.0"));
    }

    @Test
    void adjustQuantity_上限を超える場合は400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        InventoryItemEntity item = new InventoryItemEntity();
        item.setId(5L);
        item.setHouseholdId(10L);
        item.setQuantity(new BigDecimal("99999.9"));
        when(inventoryItemMapper.findById(5L)).thenReturn(item);
        when(inventoryItemMapper.updateQuantity(5L, new BigDecimal("0.1"))).thenReturn(0);

        assertThatThrownBy(() -> service().adjustQuantity(1L, 5L, new QuantityAdjustRequest(new BigDecimal("0.1"))))
                .isInstanceOf(BadRequestException.class);
        verify(inventoryItemMapper).updateQuantity(5L, new BigDecimal("0.1"));
    }

    @Test
    void createItem_数量が小数点第二位以下の場合は400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(zaikoCategoryMapper.findById(3L)).thenReturn(categoryOf(3L, 10L));

        assertThatThrownBy(() -> service().createItem(1L,
                new CreateInventoryItemRequest("牛乳", 3L, null, new BigDecimal("1.05"), new BigDecimal("0.5"))))
                .isInstanceOf(BadRequestException.class);
        verify(inventoryItemMapper, never()).insert(any());
    }

    @Test
    void updateItem_閾値が小数点第二位以下の場合は400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        InventoryItemEntity item = new InventoryItemEntity();
        item.setId(5L);
        item.setHouseholdId(10L);
        when(inventoryItemMapper.findById(5L)).thenReturn(item);
        when(zaikoCategoryMapper.findById(3L)).thenReturn(categoryOf(3L, 10L));

        assertThatThrownBy(() -> service().updateItem(1L, 5L,
                new UpdateInventoryItemRequest("牛乳(改)", 3L, null, new BigDecimal("0.85"))))
                .isInstanceOf(BadRequestException.class);
        verify(inventoryItemMapper, never()).update(anyLong(), any(), anyLong(), any(), any());
    }

    @Test
    void adjustQuantity_増減量が小数点第二位以下の場合は400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        InventoryItemEntity item = new InventoryItemEntity();
        item.setId(5L);
        item.setHouseholdId(10L);
        when(inventoryItemMapper.findById(5L)).thenReturn(item);

        assertThatThrownBy(() -> service().adjustQuantity(1L, 5L,
                new QuantityAdjustRequest(new BigDecimal("0.05"))))
                .isInstanceOf(BadRequestException.class);
        verify(inventoryItemMapper, never()).updateQuantity(anyLong(), any());
    }

    @Test
    void deleteItem_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        InventoryItemEntity item = new InventoryItemEntity();
        item.setId(5L);
        item.setHouseholdId(10L);
        when(inventoryItemMapper.findById(5L)).thenReturn(item);

        service().deleteItem(1L, 5L);

        verify(inventoryItemMapper).delete(5L);
    }

    @Test
    void deleteItem_他世帯のアイテムは404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        InventoryItemEntity item = new InventoryItemEntity();
        item.setId(5L);
        item.setHouseholdId(999L);
        when(inventoryItemMapper.findById(5L)).thenReturn(item);

        assertThatThrownBy(() -> service().deleteItem(1L, 5L)).isInstanceOf(ResourceNotFoundException.class);
        verify(inventoryItemMapper, never()).delete(anyLong());
    }
}

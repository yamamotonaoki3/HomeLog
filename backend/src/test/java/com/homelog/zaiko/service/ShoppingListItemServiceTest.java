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
import com.homelog.zaiko.dto.request.CreateShoppingListItemRequest;
import com.homelog.zaiko.dto.request.ProcessPurchaseRequest;
import com.homelog.zaiko.dto.request.PurchaseLineRequest;
import com.homelog.zaiko.dto.response.ProcessPurchaseResponse;
import com.homelog.zaiko.dto.response.ShoppingListItemResponse;
import com.homelog.zaiko.entity.InventoryItemEntity;
import com.homelog.zaiko.entity.ShoppingListItemEntity;
import com.homelog.zaiko.mapper.InventoryItemMapper;
import com.homelog.zaiko.mapper.ShoppingListItemMapper;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ShoppingListItemServiceTest {

    @Mock
    private ShoppingListItemMapper shoppingListItemMapper;
    @Mock
    private InventoryItemMapper inventoryItemMapper;
    @Mock
    private HouseholdMemberMapper householdMemberMapper;

    private ShoppingListItemService service() {
        return new ShoppingListItemService(shoppingListItemMapper, inventoryItemMapper, householdMemberMapper);
    }

    private HouseholdMemberEntity memberOf(long householdId) {
        HouseholdMemberEntity member = new HouseholdMemberEntity();
        member.setHouseholdId(householdId);
        return member;
    }

    private InventoryItemEntity itemOf(long id, long householdId) {
        InventoryItemEntity item = new InventoryItemEntity();
        item.setId(id);
        item.setHouseholdId(householdId);
        item.setName("牛乳");
        return item;
    }

    @Test
    void listItems_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        ShoppingListItemEntity entity = new ShoppingListItemEntity();
        entity.setId(1L);
        entity.setInventoryItemId(100L);
        entity.setName("牛乳");
        entity.setPurchasedQuantity(BigDecimal.ZERO);
        when(shoppingListItemMapper.findByHouseholdId(10L, "NAME")).thenReturn(List.of(entity));

        List<ShoppingListItemResponse> response = service().listItems(1L, null);

        assertThat(response).hasSize(1);
        assertThat(response.get(0).name()).isEqualTo("牛乳");
    }

    @Test
    void listItems_不正なsortはNAMEにフォールバック() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(shoppingListItemMapper.findByHouseholdId(10L, "NAME")).thenReturn(List.of());

        service().listItems(1L, "invalid");

        verify(shoppingListItemMapper).findByHouseholdId(10L, "NAME");
    }

    @Test
    void listItems_sort大文字小文字を無視する() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(shoppingListItemMapper.findByHouseholdId(10L, "CATEGORY")).thenReturn(List.of());

        service().listItems(1L, "category");

        verify(shoppingListItemMapper).findByHouseholdId(10L, "CATEGORY");
    }

    @Test
    void createManualItem_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(inventoryItemMapper.findById(100L)).thenReturn(itemOf(100L, 10L));
        when(shoppingListItemMapper.existsByInventoryItemId(100L)).thenReturn(false);

        ShoppingListItemResponse response = service().createManualItem(1L, new CreateShoppingListItemRequest(100L));

        assertThat(response.inventoryItemId()).isEqualTo(100L);
        assertThat(response.isManual()).isTrue();
        verify(shoppingListItemMapper).insert(any(ShoppingListItemEntity.class));
    }

    @Test
    void createManualItem_既に追加済みは400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(inventoryItemMapper.findById(100L)).thenReturn(itemOf(100L, 10L));
        when(shoppingListItemMapper.existsByInventoryItemId(100L)).thenReturn(true);

        assertThatThrownBy(() -> service().createManualItem(1L, new CreateShoppingListItemRequest(100L)))
                .isInstanceOf(BadRequestException.class);
        verify(shoppingListItemMapper, never()).insert(any());
    }

    @Test
    void createManualItem_他世帯の在庫アイテムは400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(inventoryItemMapper.findById(100L)).thenReturn(itemOf(100L, 999L));

        assertThatThrownBy(() -> service().createManualItem(1L, new CreateShoppingListItemRequest(100L)))
                .isInstanceOf(BadRequestException.class);
        verify(shoppingListItemMapper, never()).insert(any());
    }

    @Test
    void deleteItem_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        ShoppingListItemEntity entity = new ShoppingListItemEntity();
        entity.setId(1L);
        entity.setHouseholdId(10L);
        when(shoppingListItemMapper.findById(1L)).thenReturn(entity);

        service().deleteItem(1L, 1L);

        verify(shoppingListItemMapper).delete(1L);
    }

    @Test
    void deleteItem_他世帯の品目は404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        ShoppingListItemEntity entity = new ShoppingListItemEntity();
        entity.setId(1L);
        entity.setHouseholdId(999L);
        when(shoppingListItemMapper.findById(1L)).thenReturn(entity);

        assertThatThrownBy(() -> service().deleteItem(1L, 1L)).isInstanceOf(ResourceNotFoundException.class);
        verify(shoppingListItemMapper, never()).delete(anyLong());
    }

    @Test
    void processPurchase_閾値到達で買い物リストから削除される() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        ShoppingListItemEntity entity = new ShoppingListItemEntity();
        entity.setId(1L);
        entity.setHouseholdId(10L);
        entity.setInventoryItemId(100L);
        entity.setManual(false);
        when(shoppingListItemMapper.findById(1L)).thenReturn(entity);
        when(inventoryItemMapper.updateQuantity(100L, new BigDecimal("1.0"))).thenReturn(1);
        InventoryItemEntity item = itemOf(100L, 10L);
        item.setQuantity(new BigDecimal("1.0"));
        item.setThreshold(new BigDecimal("0.5"));
        when(inventoryItemMapper.findById(100L)).thenReturn(item);

        ProcessPurchaseResponse response = service().processPurchase(1L,
                new ProcessPurchaseRequest(List.of(new PurchaseLineRequest(1L, new BigDecimal("1.0")))));

        assertThat(response.removedShoppingListItemIds()).containsExactly(1L);
        assertThat(response.updatedInventoryItems()).hasSize(1);
        verify(shoppingListItemMapper).delete(1L);
        verify(shoppingListItemMapper, never()).resetPurchase(anyLong());
    }

    @Test
    void processPurchase_閾値未達なら残ってpurchasedがリセットされる() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        ShoppingListItemEntity entity = new ShoppingListItemEntity();
        entity.setId(1L);
        entity.setHouseholdId(10L);
        entity.setInventoryItemId(100L);
        entity.setManual(false);
        when(shoppingListItemMapper.findById(1L)).thenReturn(entity);
        when(inventoryItemMapper.updateQuantity(100L, new BigDecimal("0.1"))).thenReturn(1);
        InventoryItemEntity item = itemOf(100L, 10L);
        item.setQuantity(new BigDecimal("0.2"));
        item.setThreshold(new BigDecimal("0.5"));
        when(inventoryItemMapper.findById(100L)).thenReturn(item);

        ProcessPurchaseResponse response = service().processPurchase(1L,
                new ProcessPurchaseRequest(List.of(new PurchaseLineRequest(1L, new BigDecimal("0.1")))));

        assertThat(response.removedShoppingListItemIds()).isEmpty();
        verify(shoppingListItemMapper).resetPurchase(1L);
        verify(shoppingListItemMapper, never()).delete(anyLong());
    }

    @Test
    void processPurchase_手動追加分は閾値に関わらず削除される() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        ShoppingListItemEntity entity = new ShoppingListItemEntity();
        entity.setId(1L);
        entity.setHouseholdId(10L);
        entity.setInventoryItemId(100L);
        entity.setManual(true);
        when(shoppingListItemMapper.findById(1L)).thenReturn(entity);
        when(inventoryItemMapper.updateQuantity(100L, new BigDecimal("0.1"))).thenReturn(1);
        InventoryItemEntity item = itemOf(100L, 10L);
        item.setQuantity(new BigDecimal("0.2"));
        item.setThreshold(new BigDecimal("0.5"));
        when(inventoryItemMapper.findById(100L)).thenReturn(item);

        ProcessPurchaseResponse response = service().processPurchase(1L,
                new ProcessPurchaseRequest(List.of(new PurchaseLineRequest(1L, new BigDecimal("0.1")))));

        assertThat(response.removedShoppingListItemIds()).containsExactly(1L);
        verify(shoppingListItemMapper).delete(1L);
        verify(shoppingListItemMapper, never()).resetPurchase(anyLong());
    }

    @Test
    void processPurchase_他世帯の品目は404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        ShoppingListItemEntity entity = new ShoppingListItemEntity();
        entity.setId(1L);
        entity.setHouseholdId(999L);
        when(shoppingListItemMapper.findById(1L)).thenReturn(entity);

        assertThatThrownBy(() -> service().processPurchase(1L,
                new ProcessPurchaseRequest(List.of(new PurchaseLineRequest(1L, new BigDecimal("0.1"))))))
                .isInstanceOf(ResourceNotFoundException.class);
        verify(inventoryItemMapper, never()).updateQuantity(anyLong(), any());
    }

    @Test
    void processPurchase_在庫個数が範囲外なら400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        ShoppingListItemEntity entity = new ShoppingListItemEntity();
        entity.setId(1L);
        entity.setHouseholdId(10L);
        entity.setInventoryItemId(100L);
        when(shoppingListItemMapper.findById(1L)).thenReturn(entity);
        when(inventoryItemMapper.updateQuantity(100L, new BigDecimal("999999.9"))).thenReturn(0);

        assertThatThrownBy(() -> service().processPurchase(1L,
                new ProcessPurchaseRequest(List.of(new PurchaseLineRequest(1L, new BigDecimal("999999.9"))))))
                .isInstanceOf(BadRequestException.class);
    }
}

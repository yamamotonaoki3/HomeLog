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
import com.homelog.zaiko.entity.ShoppingListItemEntity;
import com.homelog.zaiko.entity.StoreEntity;
import com.homelog.zaiko.entity.ZaikoCategoryEntity;
import com.homelog.zaiko.mapper.InventoryItemMapper;
import com.homelog.zaiko.mapper.ShoppingListItemMapper;
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
    @Mock
    private ShoppingListItemMapper shoppingListItemMapper;

    private InventoryItemService service() {
        return new InventoryItemService(inventoryItemMapper, zaikoCategoryMapper, storeMapper, householdMemberMapper,
                shoppingListItemMapper);
    }

    private HouseholdMemberEntity memberOf(long householdId) {
        HouseholdMemberEntity member = new HouseholdMemberEntity();
        member.setHouseholdId(householdId);
        return member;
    }

    private void stubInventoryItemInsertSetsId() {
        org.mockito.Mockito.doAnswer(invocation -> {
            InventoryItemEntity entity = invocation.getArgument(0);
            entity.setId(100L);
            return null;
        }).when(inventoryItemMapper).insert(any(InventoryItemEntity.class));
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
        stubInventoryItemInsertSetsId();

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
        item.setQuantity(new BigDecimal("1.0"));
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
        updatedItem.setThreshold(new BigDecimal("0.5"));
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

    @Test
    void deleteItem_買い物リストの行も削除される() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        InventoryItemEntity item = new InventoryItemEntity();
        item.setId(5L);
        item.setHouseholdId(10L);
        when(inventoryItemMapper.findById(5L)).thenReturn(item);

        service().deleteItem(1L, 5L);

        verify(shoppingListItemMapper).deleteByInventoryItemId(5L);
        verify(inventoryItemMapper).delete(5L);
    }

    @Test
    void createItem_閾値未満なら買い物リストに自動追加される() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(zaikoCategoryMapper.findById(3L)).thenReturn(categoryOf(3L, 10L));
        stubInventoryItemInsertSetsId();
        when(shoppingListItemMapper.existsByInventoryItemId(100L)).thenReturn(false);

        service().createItem(1L,
                new CreateInventoryItemRequest("牛乳", 3L, null, new BigDecimal("0.3"), new BigDecimal("0.5")));

        verify(shoppingListItemMapper).insert(any(ShoppingListItemEntity.class));
    }

    @Test
    void createItem_閾値以上なら買い物リストに追加しない() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(zaikoCategoryMapper.findById(3L)).thenReturn(categoryOf(3L, 10L));
        stubInventoryItemInsertSetsId();

        service().createItem(1L,
                new CreateInventoryItemRequest("牛乳", 3L, null, new BigDecimal("1.0"), new BigDecimal("0.5")));

        verify(shoppingListItemMapper, never()).insert(any());
    }

    @Test
    void createItem_閾値未満でも手動追加済みなら二重追加しない() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(zaikoCategoryMapper.findById(3L)).thenReturn(categoryOf(3L, 10L));
        stubInventoryItemInsertSetsId();
        when(shoppingListItemMapper.existsByInventoryItemId(100L)).thenReturn(true);

        service().createItem(1L,
                new CreateInventoryItemRequest("牛乳", 3L, null, new BigDecimal("0.3"), new BigDecimal("0.5")));

        verify(shoppingListItemMapper, never()).insert(any());
    }

    @Test
    void updateItem_閾値変更で新たに閾値未満になれば自動追加される() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        InventoryItemEntity item = new InventoryItemEntity();
        item.setId(5L);
        item.setHouseholdId(10L);
        item.setQuantity(new BigDecimal("1.0"));
        when(inventoryItemMapper.findById(5L)).thenReturn(item);
        when(zaikoCategoryMapper.findById(3L)).thenReturn(categoryOf(3L, 10L));
        when(shoppingListItemMapper.existsByInventoryItemId(5L)).thenReturn(false);

        service().updateItem(1L, 5L, new UpdateInventoryItemRequest("牛乳", 3L, null, new BigDecimal("2.0")));

        verify(shoppingListItemMapper).insert(any(ShoppingListItemEntity.class));
    }

    @Test
    void updateItem_閾値変更で閾値未満でも手動追加済みなら二重追加しない() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        InventoryItemEntity item = new InventoryItemEntity();
        item.setId(5L);
        item.setHouseholdId(10L);
        item.setQuantity(new BigDecimal("1.0"));
        when(inventoryItemMapper.findById(5L)).thenReturn(item);
        when(zaikoCategoryMapper.findById(3L)).thenReturn(categoryOf(3L, 10L));
        when(shoppingListItemMapper.existsByInventoryItemId(5L)).thenReturn(true);

        service().updateItem(1L, 5L, new UpdateInventoryItemRequest("牛乳", 3L, null, new BigDecimal("2.0")));

        verify(shoppingListItemMapper, never()).insert(any());
    }

    @Test
    void updateItem_閾値変更で閾値以上に戻れば自動追加分は削除される() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        InventoryItemEntity item = new InventoryItemEntity();
        item.setId(5L);
        item.setHouseholdId(10L);
        item.setQuantity(new BigDecimal("1.0"));
        when(inventoryItemMapper.findById(5L)).thenReturn(item);
        when(zaikoCategoryMapper.findById(3L)).thenReturn(categoryOf(3L, 10L));
        ShoppingListItemEntity autoEntry = new ShoppingListItemEntity();
        autoEntry.setId(9L);
        when(shoppingListItemMapper.findByInventoryItemIdAndManual(5L, false)).thenReturn(autoEntry);

        service().updateItem(1L, 5L, new UpdateInventoryItemRequest("牛乳", 3L, null, new BigDecimal("0.5")));

        verify(shoppingListItemMapper).deleteByInventoryItemIdAndManual(5L, false);
    }

    @Test
    void adjustQuantity_閾値を下回ったら自動追加される() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        InventoryItemEntity item = new InventoryItemEntity();
        item.setId(5L);
        item.setHouseholdId(10L);
        item.setQuantity(new BigDecimal("1.0"));
        InventoryItemEntity updatedItem = new InventoryItemEntity();
        updatedItem.setId(5L);
        updatedItem.setHouseholdId(10L);
        updatedItem.setQuantity(new BigDecimal("0.3"));
        updatedItem.setThreshold(new BigDecimal("0.5"));
        when(inventoryItemMapper.findById(5L)).thenReturn(item, updatedItem);
        when(inventoryItemMapper.updateQuantity(5L, new BigDecimal("-0.7"))).thenReturn(1);
        when(shoppingListItemMapper.existsByInventoryItemId(5L)).thenReturn(false);

        service().adjustQuantity(1L, 5L, new QuantityAdjustRequest(new BigDecimal("-0.7")));

        verify(shoppingListItemMapper).insert(any(ShoppingListItemEntity.class));
    }

    @Test
    void adjustQuantity_閾値を下回っても手動追加済みなら二重追加しない() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        InventoryItemEntity item = new InventoryItemEntity();
        item.setId(5L);
        item.setHouseholdId(10L);
        item.setQuantity(new BigDecimal("1.0"));
        InventoryItemEntity updatedItem = new InventoryItemEntity();
        updatedItem.setId(5L);
        updatedItem.setHouseholdId(10L);
        updatedItem.setQuantity(new BigDecimal("0.3"));
        updatedItem.setThreshold(new BigDecimal("0.5"));
        when(inventoryItemMapper.findById(5L)).thenReturn(item, updatedItem);
        when(inventoryItemMapper.updateQuantity(5L, new BigDecimal("-0.7"))).thenReturn(1);
        when(shoppingListItemMapper.existsByInventoryItemId(5L)).thenReturn(true);

        service().adjustQuantity(1L, 5L, new QuantityAdjustRequest(new BigDecimal("-0.7")));

        verify(shoppingListItemMapper, never()).insert(any());
    }

    @Test
    void adjustQuantity_閾値以上に回復したら自動削除される() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        InventoryItemEntity item = new InventoryItemEntity();
        item.setId(5L);
        item.setHouseholdId(10L);
        item.setQuantity(new BigDecimal("0.3"));
        InventoryItemEntity updatedItem = new InventoryItemEntity();
        updatedItem.setId(5L);
        updatedItem.setHouseholdId(10L);
        updatedItem.setQuantity(new BigDecimal("1.3"));
        updatedItem.setThreshold(new BigDecimal("0.5"));
        when(inventoryItemMapper.findById(5L)).thenReturn(item, updatedItem);
        when(inventoryItemMapper.updateQuantity(5L, new BigDecimal("1.0"))).thenReturn(1);
        ShoppingListItemEntity autoEntry = new ShoppingListItemEntity();
        autoEntry.setId(9L);
        when(shoppingListItemMapper.findByInventoryItemIdAndManual(5L, false)).thenReturn(autoEntry);

        service().adjustQuantity(1L, 5L, new QuantityAdjustRequest(new BigDecimal("1.0")));

        verify(shoppingListItemMapper).deleteByInventoryItemIdAndManual(5L, false);
    }
}

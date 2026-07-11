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
import com.homelog.zaiko.dto.request.CreateStoreRequest;
import com.homelog.zaiko.dto.request.UpdateStoreRequest;
import com.homelog.zaiko.dto.response.StoreResponse;
import com.homelog.zaiko.entity.StoreEntity;
import com.homelog.zaiko.mapper.InventoryItemMapper;
import com.homelog.zaiko.mapper.StoreMapper;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class StoreServiceTest {

    @Mock
    private StoreMapper storeMapper;
    @Mock
    private InventoryItemMapper inventoryItemMapper;
    @Mock
    private HouseholdMemberMapper householdMemberMapper;

    private StoreService service() {
        return new StoreService(storeMapper, inventoryItemMapper, householdMemberMapper);
    }

    private HouseholdMemberEntity memberOf(long householdId) {
        HouseholdMemberEntity member = new HouseholdMemberEntity();
        member.setHouseholdId(householdId);
        return member;
    }

    @Test
    void listStores_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        StoreEntity store = new StoreEntity();
        store.setId(1L);
        store.setHouseholdId(10L);
        store.setName("スーパーA");
        when(storeMapper.findByHouseholdId(10L)).thenReturn(List.of(store));

        List<StoreResponse> response = service().listStores(1L);

        assertThat(response).hasSize(1);
        assertThat(response.get(0).name()).isEqualTo("スーパーA");
    }

    @Test
    void createStore_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));

        StoreResponse response = service().createStore(1L, new CreateStoreRequest("スーパーB"));

        assertThat(response.name()).isEqualTo("スーパーB");
        verify(storeMapper).insert(any(StoreEntity.class));
    }

    @Test
    void updateStore_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        StoreEntity store = new StoreEntity();
        store.setId(5L);
        store.setHouseholdId(10L);
        store.setName("旧名");
        when(storeMapper.findById(5L)).thenReturn(store);

        StoreResponse response = service().updateStore(1L, 5L, new UpdateStoreRequest("新名"));

        assertThat(response.name()).isEqualTo("新名");
        verify(storeMapper).update(5L, "新名");
    }

    @Test
    void updateStore_他世帯の店舗は404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        StoreEntity store = new StoreEntity();
        store.setId(5L);
        store.setHouseholdId(999L);
        when(storeMapper.findById(5L)).thenReturn(store);

        assertThatThrownBy(() -> service().updateStore(1L, 5L, new UpdateStoreRequest("新名")))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void deleteStore_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        StoreEntity store = new StoreEntity();
        store.setId(5L);
        store.setHouseholdId(10L);
        when(storeMapper.findById(5L)).thenReturn(store);
        when(inventoryItemMapper.countByStoreId(5L)).thenReturn(0);

        service().deleteStore(1L, 5L);

        verify(storeMapper).delete(5L);
    }

    @Test
    void deleteStore_使用中は削除不可() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        StoreEntity store = new StoreEntity();
        store.setId(5L);
        store.setHouseholdId(10L);
        when(storeMapper.findById(5L)).thenReturn(store);
        when(inventoryItemMapper.countByStoreId(5L)).thenReturn(2);

        assertThatThrownBy(() -> service().deleteStore(1L, 5L)).isInstanceOf(BadRequestException.class);
        verify(storeMapper, never()).delete(anyLong());
    }

    @Test
    void listStores_未所属の場合は404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(null);

        assertThatThrownBy(() -> service().listStores(1L)).isInstanceOf(ResourceNotFoundException.class);
    }
}

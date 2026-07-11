package com.homelog.zaiko.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.homelog.household.entity.HouseholdEntity;
import com.homelog.household.mapper.HouseholdMapper;
import com.homelog.zaiko.entity.InventoryItemEntity;
import com.homelog.zaiko.entity.StoreEntity;
import com.homelog.zaiko.entity.ZaikoCategoryEntity;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class InventoryItemMapperTest {

    @Autowired
    private InventoryItemMapper inventoryItemMapper;

    @Autowired
    private ZaikoCategoryMapper zaikoCategoryMapper;

    @Autowired
    private StoreMapper storeMapper;

    @Autowired
    private HouseholdMapper householdMapper;

    @Test
    void insertAndFindById_正常系() {
        Long householdId = createHousehold("item-house", "ITEMCODE0000001");
        Long categoryId = createCategory(householdId, "野菜");
        Long storeId = createStore(householdId, "スーパーA");

        InventoryItemEntity item = new InventoryItemEntity();
        item.setHouseholdId(householdId);
        item.setName("牛乳");
        item.setCategoryId(categoryId);
        item.setStoreId(storeId);
        item.setQuantity(new BigDecimal("1.0"));
        item.setThreshold(new BigDecimal("0.5"));

        inventoryItemMapper.insert(item);

        assertThat(item.getId()).isNotNull();
        InventoryItemEntity found = inventoryItemMapper.findById(item.getId());
        assertThat(found.getName()).isEqualTo("牛乳");
        assertThat(found.getQuantity()).isEqualByComparingTo("1.0");
        assertThat(found.getThreshold()).isEqualByComparingTo("0.5");
    }

    @Test
    void findByHouseholdId_世帯に紐づくアイテムのみ取得できる() {
        Long householdId1 = createHousehold("item-house1", "ITEMCODE0000002");
        Long householdId2 = createHousehold("item-house2", "ITEMCODE0000003");
        Long categoryId1 = createCategory(householdId1, "野菜");
        Long categoryId2 = createCategory(householdId2, "肉");
        insertItem(householdId1, "きゅうり", categoryId1, null);
        insertItem(householdId2, "豚肉", categoryId2, null);

        List<InventoryItemEntity> found = inventoryItemMapper.findByHouseholdId(householdId1);

        assertThat(found).hasSize(1);
        assertThat(found.get(0).getName()).isEqualTo("きゅうり");
    }

    @Test
    void update_正常系() {
        Long householdId = createHousehold("item-house3", "ITEMCODE0000004");
        Long categoryId = createCategory(householdId, "調味料");
        Long itemId = insertItem(householdId, "醤油", categoryId, null);

        inventoryItemMapper.update(itemId, "濃口醤油", categoryId, null, new BigDecimal("1.0"));

        InventoryItemEntity found = inventoryItemMapper.findById(itemId);
        assertThat(found.getName()).isEqualTo("濃口醤油");
        assertThat(found.getThreshold()).isEqualByComparingTo("1.0");
    }

    @Test
    void updateQuantity_差分を加算できる() {
        Long householdId = createHousehold("item-house4", "ITEMCODE0000005");
        Long categoryId = createCategory(householdId, "飲料");
        Long itemId = insertItem(householdId, "お茶", categoryId, null);

        int updatedRows = inventoryItemMapper.updateQuantity(itemId, new BigDecimal("1.5"));

        InventoryItemEntity found = inventoryItemMapper.findById(itemId);
        assertThat(updatedRows).isEqualTo(1);
        assertThat(found.getQuantity()).isEqualByComparingTo("2.5");
    }

    @Test
    void updateQuantity_0未満になる差分は更新しない() {
        Long householdId = createHousehold("item-house4-negative", "ITEMCODE0000015");
        Long categoryId = createCategory(householdId, "飲料");
        Long itemId = insertItem(householdId, "お茶", categoryId, null);

        int updatedRows = inventoryItemMapper.updateQuantity(itemId, new BigDecimal("-1.5"));

        InventoryItemEntity found = inventoryItemMapper.findById(itemId);
        assertThat(updatedRows).isZero();
        assertThat(found.getQuantity()).isEqualByComparingTo("1.0");
    }

    @Test
    void updateQuantity_上限を超える差分は更新しない() {
        Long householdId = createHousehold("item-house4-overflow", "ITEMCODE0000016");
        Long categoryId = createCategory(householdId, "飲料");
        InventoryItemEntity item = new InventoryItemEntity();
        item.setHouseholdId(householdId);
        item.setName("大量ストック");
        item.setCategoryId(categoryId);
        item.setQuantity(new BigDecimal("99999.9"));
        item.setThreshold(new BigDecimal("0.5"));
        inventoryItemMapper.insert(item);

        int updatedRows = inventoryItemMapper.updateQuantity(item.getId(), new BigDecimal("0.1"));

        InventoryItemEntity found = inventoryItemMapper.findById(item.getId());
        assertThat(updatedRows).isZero();
        assertThat(found.getQuantity()).isEqualByComparingTo("99999.9");
    }

    @Test
    void delete_正常系() {
        Long householdId = createHousehold("item-house5", "ITEMCODE0000006");
        Long categoryId = createCategory(householdId, "冷凍食品");
        Long itemId = insertItem(householdId, "冷凍餃子", categoryId, null);

        inventoryItemMapper.delete(itemId);

        assertThat(inventoryItemMapper.findById(itemId)).isNull();
    }

    @Test
    void countByCategoryId_使用中の件数を取得できる() {
        Long householdId = createHousehold("item-house6", "ITEMCODE0000007");
        Long categoryId = createCategory(householdId, "乾物");
        insertItem(householdId, "わかめ", categoryId, null);

        assertThat(inventoryItemMapper.countByCategoryId(categoryId)).isEqualTo(1);
    }

    @Test
    void countByStoreId_使用中の件数を取得できる() {
        Long householdId = createHousehold("item-house7", "ITEMCODE0000008");
        Long categoryId = createCategory(householdId, "卵");
        Long storeId = createStore(householdId, "スーパーB");
        insertItem(householdId, "卵", categoryId, storeId);

        assertThat(inventoryItemMapper.countByStoreId(storeId)).isEqualTo(1);
    }

    private Long insertItem(Long householdId, String name, Long categoryId, Long storeId) {
        InventoryItemEntity item = new InventoryItemEntity();
        item.setHouseholdId(householdId);
        item.setName(name);
        item.setCategoryId(categoryId);
        item.setStoreId(storeId);
        item.setQuantity(new BigDecimal("1.0"));
        item.setThreshold(new BigDecimal("0.5"));
        inventoryItemMapper.insert(item);
        return item.getId();
    }

    private Long createCategory(Long householdId, String name) {
        ZaikoCategoryEntity category = new ZaikoCategoryEntity();
        category.setHouseholdId(householdId);
        category.setName(name);
        category.setDefault(false);
        zaikoCategoryMapper.insert(category);
        return category.getId();
    }

    private Long createStore(Long householdId, String name) {
        StoreEntity store = new StoreEntity();
        store.setHouseholdId(householdId);
        store.setName(name);
        storeMapper.insert(store);
        return store.getId();
    }

    private Long createHousehold(String name, String inviteCode) {
        HouseholdEntity household = new HouseholdEntity();
        household.setName(name);
        household.setInviteCode(inviteCode);
        household.setCreatedAt(LocalDateTime.now());
        householdMapper.insert(household);
        return household.getId();
    }
}

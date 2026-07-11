package com.homelog.zaiko.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.homelog.household.entity.HouseholdEntity;
import com.homelog.household.mapper.HouseholdMapper;
import com.homelog.zaiko.entity.InventoryItemEntity;
import com.homelog.zaiko.entity.ShoppingListItemEntity;
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
class ShoppingListItemMapperTest {

    @Autowired
    private ShoppingListItemMapper shoppingListItemMapper;

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
        Long householdId = createHousehold("sli-house", "SLICODE0000001");
        Long itemId = createItem(householdId, "牛乳", null);

        ShoppingListItemEntity entity = newEntity(householdId, itemId, false);
        shoppingListItemMapper.insert(entity);

        assertThat(entity.getId()).isNotNull();
        ShoppingListItemEntity found = shoppingListItemMapper.findById(entity.getId());
        assertThat(found.getInventoryItemId()).isEqualTo(itemId);
        assertThat(found.isManual()).isFalse();
        assertThat(found.isPurchased()).isFalse();
        assertThat(found.getPurchasedQuantity()).isEqualByComparingTo("0");
    }

    @Test
    void findByHouseholdId_品名順で取得できる() {
        Long householdId = createHousehold("sli-house-name", "SLICODE0000002");
        Long itemA = createItem(householdId, "にんじん", null);
        Long itemB = createItem(householdId, "あさり", null);
        shoppingListItemMapper.insert(newEntity(householdId, itemA, false));
        shoppingListItemMapper.insert(newEntity(householdId, itemB, false));

        List<ShoppingListItemEntity> found = shoppingListItemMapper.findByHouseholdId(householdId, "NAME");

        assertThat(found).hasSize(2);
        assertThat(found.get(0).getName()).isEqualTo("あさり");
        assertThat(found.get(1).getName()).isEqualTo("にんじん");
    }

    @Test
    void countByHouseholdId_世帯に紐づく件数のみ取得できる() {
        Long householdId1 = createHousehold("sli-house-count1", "SLICODE0000011");
        Long householdId2 = createHousehold("sli-house-count2", "SLICODE0000012");
        Long item1 = createItem(householdId1, "牛乳", null);
        Long item2 = createItem(householdId2, "パン", null);
        shoppingListItemMapper.insert(newEntity(householdId1, item1, false));
        shoppingListItemMapper.insert(newEntity(householdId2, item2, false));

        assertThat(shoppingListItemMapper.countByHouseholdId(householdId1)).isEqualTo(1);
    }

    @Test
    void findByHouseholdId_店舗順で取得できる() {
        Long householdId = createHousehold("sli-house-store", "SLICODE0000003");
        Long storeA = createStore(householdId, "Aマート");
        Long storeB = createStore(householdId, "Zマート");
        Long itemA = createItem(householdId, "商品A", storeB);
        Long itemB = createItem(householdId, "商品B", storeA);
        shoppingListItemMapper.insert(newEntity(householdId, itemA, false));
        shoppingListItemMapper.insert(newEntity(householdId, itemB, false));

        List<ShoppingListItemEntity> found = shoppingListItemMapper.findByHouseholdId(householdId, "STORE");

        assertThat(found).hasSize(2);
        assertThat(found.get(0).getName()).isEqualTo("商品B");
        assertThat(found.get(1).getName()).isEqualTo("商品A");
    }

    @Test
    void findByInventoryItemIdAndManual_正常系() {
        Long householdId = createHousehold("sli-house-manual", "SLICODE0000004");
        Long itemId = createItem(householdId, "醤油", null);
        shoppingListItemMapper.insert(newEntity(householdId, itemId, false));

        ShoppingListItemEntity found = shoppingListItemMapper.findByInventoryItemIdAndManual(itemId, false);

        assertThat(found).isNotNull();
        assertThat(found.isManual()).isFalse();
    }

    @Test
    void findByInventoryItemIdAndManual_該当なしはnull() {
        Long householdId = createHousehold("sli-house-manual2", "SLICODE0000005");
        Long itemId = createItem(householdId, "味噌", null);
        shoppingListItemMapper.insert(newEntity(householdId, itemId, false));

        ShoppingListItemEntity found = shoppingListItemMapper.findByInventoryItemIdAndManual(itemId, true);

        assertThat(found).isNull();
    }

    @Test
    void existsByInventoryItemId_正常系() {
        Long householdId = createHousehold("sli-house-exists", "SLICODE0000006");
        Long itemId = createItem(householdId, "海苔", null);
        shoppingListItemMapper.insert(newEntity(householdId, itemId, true));

        assertThat(shoppingListItemMapper.existsByInventoryItemId(itemId)).isTrue();
        assertThat(shoppingListItemMapper.existsByInventoryItemId(999999L)).isFalse();
    }

    @Test
    void deleteByInventoryItemIdAndManual_正常系() {
        Long householdId = createHousehold("sli-house-del1", "SLICODE0000007");
        Long itemId = createItem(householdId, "わかめ", null);
        shoppingListItemMapper.insert(newEntity(householdId, itemId, false));

        shoppingListItemMapper.deleteByInventoryItemIdAndManual(itemId, false);

        assertThat(shoppingListItemMapper.existsByInventoryItemId(itemId)).isFalse();
    }

    @Test
    void deleteByInventoryItemId_正常系() {
        Long householdId = createHousehold("sli-house-del2", "SLICODE0000008");
        Long itemId = createItem(householdId, "米", null);
        shoppingListItemMapper.insert(newEntity(householdId, itemId, false));
        shoppingListItemMapper.insert(newEntity(householdId, itemId, true));

        shoppingListItemMapper.deleteByInventoryItemId(itemId);

        assertThat(shoppingListItemMapper.existsByInventoryItemId(itemId)).isFalse();
    }

    @Test
    void delete_正常系() {
        Long householdId = createHousehold("sli-house-del3", "SLICODE0000009");
        Long itemId = createItem(householdId, "パン", null);
        ShoppingListItemEntity entity = newEntity(householdId, itemId, false);
        shoppingListItemMapper.insert(entity);

        shoppingListItemMapper.delete(entity.getId());

        assertThat(shoppingListItemMapper.findById(entity.getId())).isNull();
    }

    @Test
    void resetPurchase_正常系() {
        Long householdId = createHousehold("sli-house-reset", "SLICODE0000010");
        Long itemId = createItem(householdId, "卵", null);
        ShoppingListItemEntity entity = newEntity(householdId, itemId, false);
        entity.setPurchased(true);
        entity.setPurchasedQuantity(new BigDecimal("2.0"));
        shoppingListItemMapper.insert(entity);

        shoppingListItemMapper.resetPurchase(entity.getId());

        ShoppingListItemEntity found = shoppingListItemMapper.findById(entity.getId());
        assertThat(found.isPurchased()).isFalse();
        assertThat(found.getPurchasedQuantity()).isEqualByComparingTo("0");
    }

    private ShoppingListItemEntity newEntity(Long householdId, Long itemId, boolean isManual) {
        ShoppingListItemEntity entity = new ShoppingListItemEntity();
        entity.setHouseholdId(householdId);
        entity.setInventoryItemId(itemId);
        entity.setManual(isManual);
        entity.setPurchased(false);
        entity.setPurchasedQuantity(BigDecimal.ZERO);
        entity.setAddedAt(LocalDateTime.now());
        return entity;
    }

    private Long createItem(Long householdId, String name, Long storeId) {
        Long categoryId = createCategory(householdId, name + "カテゴリ");
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

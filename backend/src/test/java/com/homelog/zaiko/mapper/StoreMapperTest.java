package com.homelog.zaiko.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.homelog.household.entity.HouseholdEntity;
import com.homelog.household.mapper.HouseholdMapper;
import com.homelog.zaiko.entity.StoreEntity;
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
class StoreMapperTest {

    @Autowired
    private StoreMapper storeMapper;

    @Autowired
    private HouseholdMapper householdMapper;

    @Test
    void insertAndFindById_正常系() {
        Long householdId = createHousehold("store-house", "STORECODE0000001");
        StoreEntity store = new StoreEntity();
        store.setHouseholdId(householdId);
        store.setName("スーパーA");

        storeMapper.insert(store);

        assertThat(store.getId()).isNotNull();
        StoreEntity found = storeMapper.findById(store.getId());
        assertThat(found.getName()).isEqualTo("スーパーA");
    }

    @Test
    void findByHouseholdId_世帯に紐づく店舗のみ取得できる() {
        Long householdId1 = createHousehold("store-house1", "STORECODE0000002");
        Long householdId2 = createHousehold("store-house2", "STORECODE0000003");
        insertStore(householdId1, "スーパーB");
        insertStore(householdId2, "スーパーC");

        List<StoreEntity> found = storeMapper.findByHouseholdId(householdId1);

        assertThat(found).hasSize(1);
        assertThat(found.get(0).getName()).isEqualTo("スーパーB");
    }

    @Test
    void update_正常系() {
        Long householdId = createHousehold("store-house3", "STORECODE0000004");
        Long storeId = insertStore(householdId, "スーパーD");

        storeMapper.update(storeId, "スーパーD（改称）");

        StoreEntity found = storeMapper.findById(storeId);
        assertThat(found.getName()).isEqualTo("スーパーD（改称）");
    }

    @Test
    void delete_正常系() {
        Long householdId = createHousehold("store-house4", "STORECODE0000005");
        Long storeId = insertStore(householdId, "スーパーE");

        storeMapper.delete(storeId);

        assertThat(storeMapper.findById(storeId)).isNull();
    }

    private Long insertStore(Long householdId, String name) {
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

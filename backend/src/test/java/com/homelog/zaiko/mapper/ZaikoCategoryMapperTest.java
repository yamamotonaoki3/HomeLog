package com.homelog.zaiko.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.homelog.household.entity.HouseholdEntity;
import com.homelog.household.mapper.HouseholdMapper;
import com.homelog.zaiko.entity.ZaikoCategoryEntity;
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
class ZaikoCategoryMapperTest {

    @Autowired
    private ZaikoCategoryMapper zaikoCategoryMapper;

    @Autowired
    private HouseholdMapper householdMapper;

    @Test
    void insertAndFindById_正常系() {
        Long householdId = createHousehold("cat-house", "CATCODE0000001");
        ZaikoCategoryEntity category = new ZaikoCategoryEntity();
        category.setHouseholdId(householdId);
        category.setName("野菜");
        category.setDefault(true);

        zaikoCategoryMapper.insert(category);

        assertThat(category.getId()).isNotNull();
        ZaikoCategoryEntity found = zaikoCategoryMapper.findById(category.getId());
        assertThat(found.getName()).isEqualTo("野菜");
        assertThat(found.isDefault()).isTrue();
    }

    @Test
    void findByHouseholdId_世帯に紐づくカテゴリーのみ取得できる() {
        Long householdId1 = createHousehold("cat-house1", "CATCODE0000002");
        Long householdId2 = createHousehold("cat-house2", "CATCODE0000003");
        insertCategory(householdId1, "肉", false);
        insertCategory(householdId2, "魚介", false);

        List<ZaikoCategoryEntity> found = zaikoCategoryMapper.findByHouseholdId(householdId1);

        assertThat(found).hasSize(1);
        assertThat(found.get(0).getName()).isEqualTo("肉");
    }

    @Test
    void update_正常系() {
        Long householdId = createHousehold("cat-house3", "CATCODE0000004");
        Long categoryId = insertCategory(householdId, "調味料", false);

        zaikoCategoryMapper.update(categoryId, "調味料・香辛料");

        ZaikoCategoryEntity found = zaikoCategoryMapper.findById(categoryId);
        assertThat(found.getName()).isEqualTo("調味料・香辛料");
    }

    @Test
    void delete_正常系() {
        Long householdId = createHousehold("cat-house4", "CATCODE0000005");
        Long categoryId = insertCategory(householdId, "飲料", false);

        zaikoCategoryMapper.delete(categoryId);

        assertThat(zaikoCategoryMapper.findById(categoryId)).isNull();
    }

    private Long insertCategory(Long householdId, String name, boolean isDefault) {
        ZaikoCategoryEntity category = new ZaikoCategoryEntity();
        category.setHouseholdId(householdId);
        category.setName(name);
        category.setDefault(isDefault);
        zaikoCategoryMapper.insert(category);
        return category.getId();
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

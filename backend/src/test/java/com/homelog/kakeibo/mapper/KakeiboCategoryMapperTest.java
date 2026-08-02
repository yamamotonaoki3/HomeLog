package com.homelog.kakeibo.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.homelog.household.entity.HouseholdEntity;
import com.homelog.household.mapper.HouseholdMapper;
import com.homelog.kakeibo.entity.KakeiboCategoryEntity;
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
class KakeiboCategoryMapperTest {

    @Autowired
    private KakeiboCategoryMapper kakeiboCategoryMapper;

    @Autowired
    private HouseholdMapper householdMapper;

    @Test
    void insertAndFindById_正常系() {
        Long householdId = createHousehold("cat-house", "KAKEICODE000001");
        KakeiboCategoryEntity category = new KakeiboCategoryEntity();
        category.setHouseholdId(householdId);
        category.setName("食費");
        category.setDefault(true);

        kakeiboCategoryMapper.insert(category);

        assertThat(category.getId()).isNotNull();
        KakeiboCategoryEntity found = kakeiboCategoryMapper.findById(category.getId());
        assertThat(found.getName()).isEqualTo("食費");
        assertThat(found.isDefault()).isTrue();
    }

    @Test
    void findByHouseholdId_世帯に紐づくカテゴリーのみ取得できる() {
        Long householdId1 = createHousehold("cat-house1", "KAKEICODE000002");
        Long householdId2 = createHousehold("cat-house2", "KAKEICODE000003");
        insertCategory(householdId1, "日用品", false);
        insertCategory(householdId2, "交際費", false);

        List<KakeiboCategoryEntity> found = kakeiboCategoryMapper.findByHouseholdId(householdId1);

        assertThat(found).hasSize(1);
        assertThat(found.get(0).getName()).isEqualTo("日用品");
    }

    @Test
    void update_正常系() {
        Long householdId = createHousehold("cat-house3", "KAKEICODE000004");
        Long categoryId = insertCategory(householdId, "光熱費", false);

        kakeiboCategoryMapper.update(categoryId, "光熱費・水道代");

        KakeiboCategoryEntity found = kakeiboCategoryMapper.findById(categoryId);
        assertThat(found.getName()).isEqualTo("光熱費・水道代");
    }

    @Test
    void delete_正常系() {
        Long householdId = createHousehold("cat-house4", "KAKEICODE000005");
        Long categoryId = insertCategory(householdId, "通信費", false);

        kakeiboCategoryMapper.delete(categoryId);

        assertThat(kakeiboCategoryMapper.findById(categoryId)).isNull();
    }

    @Test
    void findByHouseholdIdAndName_名前が一致するカテゴリーを取得できる() {
        Long householdId = createHousehold("cat-house5", "KAKEICODE000006");
        insertCategory(householdId, "固定費", true);

        KakeiboCategoryEntity found = kakeiboCategoryMapper.findByHouseholdIdAndName(householdId, "固定費");

        assertThat(found).isNotNull();
        assertThat(found.getName()).isEqualTo("固定費");
    }

    @Test
    void findByHouseholdIdAndName_一致するカテゴリーが無い場合はnull() {
        Long householdId = createHousehold("cat-house6", "KAKEICODE000007");

        KakeiboCategoryEntity found = kakeiboCategoryMapper.findByHouseholdIdAndName(householdId, "固定費");

        assertThat(found).isNull();
    }

    @Test
    void findByHouseholdIdAndName_異なる世帯のカテゴリーは取得しない() {
        Long householdId1 = createHousehold("cat-house7", "KAKEICODE000008");
        Long householdId2 = createHousehold("cat-house8", "KAKEICODE000009");
        insertCategory(householdId1, "固定費", true);

        KakeiboCategoryEntity found = kakeiboCategoryMapper.findByHouseholdIdAndName(householdId2, "固定費");

        assertThat(found).isNull();
    }

    private Long insertCategory(Long householdId, String name, boolean isDefault) {
        KakeiboCategoryEntity category = new KakeiboCategoryEntity();
        category.setHouseholdId(householdId);
        category.setName(name);
        category.setDefault(isDefault);
        kakeiboCategoryMapper.insert(category);
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

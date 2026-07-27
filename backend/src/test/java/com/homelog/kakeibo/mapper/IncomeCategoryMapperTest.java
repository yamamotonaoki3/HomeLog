package com.homelog.kakeibo.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.homelog.household.entity.HouseholdEntity;
import com.homelog.household.mapper.HouseholdMapper;
import com.homelog.kakeibo.entity.IncomeCategoryEntity;
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
class IncomeCategoryMapperTest {

    @Autowired
    private IncomeCategoryMapper incomeCategoryMapper;

    @Autowired
    private HouseholdMapper householdMapper;

    @Test
    void insertAndFindById_正常系() {
        Long householdId = createHousehold("inc-cat-house", "INCCATCODE00001");
        IncomeCategoryEntity category = new IncomeCategoryEntity();
        category.setHouseholdId(householdId);
        category.setName("給与");
        category.setDefault(true);

        incomeCategoryMapper.insert(category);

        assertThat(category.getId()).isNotNull();
        IncomeCategoryEntity found = incomeCategoryMapper.findById(category.getId());
        assertThat(found.getName()).isEqualTo("給与");
        assertThat(found.isDefault()).isTrue();
    }

    @Test
    void findByHouseholdId_世帯に紐づくカテゴリーのみ取得できる() {
        Long householdId1 = createHousehold("inc-cat-house1", "INCCATCODE00002");
        Long householdId2 = createHousehold("inc-cat-house2", "INCCATCODE00003");
        insertCategory(householdId1, "ボーナス", false);
        insertCategory(householdId2, "副業", false);

        List<IncomeCategoryEntity> found = incomeCategoryMapper.findByHouseholdId(householdId1);

        assertThat(found).hasSize(1);
        assertThat(found.get(0).getName()).isEqualTo("ボーナス");
    }

    @Test
    void update_正常系() {
        Long householdId = createHousehold("inc-cat-house3", "INCCATCODE00004");
        Long categoryId = insertCategory(householdId, "副業", false);

        incomeCategoryMapper.update(categoryId, "副業収入");

        IncomeCategoryEntity found = incomeCategoryMapper.findById(categoryId);
        assertThat(found.getName()).isEqualTo("副業収入");
    }

    @Test
    void delete_正常系() {
        Long householdId = createHousehold("inc-cat-house4", "INCCATCODE00005");
        Long categoryId = insertCategory(householdId, "その他", false);

        incomeCategoryMapper.delete(categoryId);

        assertThat(incomeCategoryMapper.findById(categoryId)).isNull();
    }

    private Long insertCategory(Long householdId, String name, boolean isDefault) {
        IncomeCategoryEntity category = new IncomeCategoryEntity();
        category.setHouseholdId(householdId);
        category.setName(name);
        category.setDefault(isDefault);
        incomeCategoryMapper.insert(category);
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

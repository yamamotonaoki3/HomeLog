package com.homelog.kakeibo.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.homelog.household.entity.HouseholdEntity;
import com.homelog.household.mapper.HouseholdMapper;
import com.homelog.kakeibo.entity.IncomeCategoryEntity;
import com.homelog.kakeibo.entity.IncomeEntity;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class IncomeMapperTest {

    @Autowired
    private IncomeMapper incomeMapper;

    @Autowired
    private HouseholdMapper householdMapper;

    @Autowired
    private IncomeCategoryMapper incomeCategoryMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void insertAndFindById_正常系() {
        Long householdId = createHousehold("inc-house", "INCCODE00000001");
        Long userId = createUser("earner1@example.com");
        Long categoryId = insertCategory(householdId, "給与");

        IncomeEntity income = newIncome(householdId, userId, categoryId, "300000", "7月分給与");
        incomeMapper.insert(income);

        assertThat(income.getId()).isNotNull();
        IncomeEntity found = incomeMapper.findById(income.getId());
        assertThat(found.getContent()).isEqualTo("7月分給与");
        assertThat(found.getAmount()).isEqualByComparingTo("300000");
    }

    @Test
    void findByEarnerUserId_自分の収入のみ取得できる_他人の収入は含まれない() {
        Long householdId = createHousehold("inc-house2", "INCCODE00000002");
        Long userA = createUser("income-a@example.com");
        Long userB = createUser("income-b@example.com");
        Long categoryId = insertCategory(householdId, "給与");
        insertIncome(householdId, userA, categoryId, "300000", "Aの給与");
        insertIncome(householdId, userB, categoryId, "250000", "Bの給与");

        List<IncomeEntity> found = incomeMapper.findByEarnerUserId(householdId, userA, null);

        assertThat(found).hasSize(1);
        assertThat(found.get(0).getContent()).isEqualTo("Aの給与");
    }

    @Test
    void findByEarnerUserId_categoryId指定時は絞り込まれる() {
        Long householdId = createHousehold("inc-house3", "INCCODE00000003");
        Long userId = createUser("earner3@example.com");
        Long categoryId1 = insertCategory(householdId, "給与");
        Long categoryId2 = insertCategory(householdId, "副業");
        insertIncome(householdId, userId, categoryId1, "300000", "給与収入");
        insertIncome(householdId, userId, categoryId2, "50000", "副業収入");

        List<IncomeEntity> found = incomeMapper.findByEarnerUserId(householdId, userId, categoryId1);

        assertThat(found).hasSize(1);
        assertThat(found.get(0).getContent()).isEqualTo("給与収入");
    }

    @Test
    void findByEarnerUserId_同じユーザーでも異なる世帯の収入は含まれない() {
        Long oldHouseholdId = createHousehold("inc-old-house", "INCCODE00000005");
        Long currentHouseholdId = createHousehold("inc-current-house", "INCCODE00000006");
        Long userId = createUser("moved-earner@example.com");
        Long oldCategoryId = insertCategory(oldHouseholdId, "旧世帯の給与");
        Long currentCategoryId = insertCategory(currentHouseholdId, "現世帯の給与");
        insertIncome(oldHouseholdId, userId, oldCategoryId, "300000", "旧世帯の収入");
        insertIncome(currentHouseholdId, userId, currentCategoryId, "320000", "現世帯の収入");

        List<IncomeEntity> found = incomeMapper.findByEarnerUserId(currentHouseholdId, userId, null);

        assertThat(found).hasSize(1);
        assertThat(found.get(0).getHouseholdId()).isEqualTo(currentHouseholdId);
        assertThat(found.get(0).getContent()).isEqualTo("現世帯の収入");
    }

    @Test
    void countByCategoryId_使用件数を返す() {
        Long householdId = createHousehold("inc-house4", "INCCODE00000004");
        Long userId = createUser("earner4@example.com");
        Long categoryId = insertCategory(householdId, "ボーナス");
        insertIncome(householdId, userId, categoryId, "100000", "冬季賞与");

        int count = incomeMapper.countByCategoryId(categoryId);

        assertThat(count).isEqualTo(1);
    }

    private void insertIncome(Long householdId, Long userId, Long categoryId, String amount, String content) {
        incomeMapper.insert(newIncome(householdId, userId, categoryId, amount, content));
    }

    private IncomeEntity newIncome(Long householdId, Long userId, Long categoryId, String amount, String content) {
        IncomeEntity income = new IncomeEntity();
        income.setHouseholdId(householdId);
        income.setEarnerUserId(userId);
        income.setCategoryId(categoryId);
        income.setAmount(new BigDecimal(amount));
        income.setContent(content);
        income.setIncomeDate(LocalDate.now());
        income.setCreatedAt(LocalDateTime.now());
        return income;
    }

    private Long insertCategory(Long householdId, String name) {
        IncomeCategoryEntity category = new IncomeCategoryEntity();
        category.setHouseholdId(householdId);
        category.setName(name);
        category.setDefault(false);
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

    private Long createUser(String email) {
        jdbcTemplate.update(
                "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
                email, "hash", "テスト太郎", LocalDateTime.now());
        return jdbcTemplate.queryForObject("SELECT id FROM users WHERE email = ?", Long.class, email);
    }
}

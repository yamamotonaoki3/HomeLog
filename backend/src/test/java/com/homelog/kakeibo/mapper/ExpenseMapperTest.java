package com.homelog.kakeibo.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.homelog.household.entity.HouseholdEntity;
import com.homelog.household.mapper.HouseholdMapper;
import com.homelog.kakeibo.entity.ExpenseEntity;
import com.homelog.kakeibo.entity.KakeiboCategoryEntity;
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
class ExpenseMapperTest {

    @Autowired
    private ExpenseMapper expenseMapper;

    @Autowired
    private HouseholdMapper householdMapper;

    @Autowired
    private KakeiboCategoryMapper kakeiboCategoryMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void insertAndFindById_正常系() {
        Long householdId = createHousehold("exp-house", "EXPCODE0000001");
        Long userId = createUser("payer1@example.com");
        Long categoryId = insertCategory(householdId, "食費");

        ExpenseEntity expense = newExpense(householdId, userId, categoryId, "1000", "ランチ");
        expenseMapper.insert(expense);

        assertThat(expense.getId()).isNotNull();
        ExpenseEntity found = expenseMapper.findById(expense.getId());
        assertThat(found.getPurpose()).isEqualTo("ランチ");
        assertThat(found.getAmount()).isEqualByComparingTo("1000");
    }

    @Test
    void findByPayerUserId_自分の支出のみ取得できる_他人の支出は含まれない() {
        Long householdId = createHousehold("exp-house2", "EXPCODE0000002");
        Long userA = createUser("expense-a@example.com");
        Long userB = createUser("expense-b@example.com");
        Long categoryId = insertCategory(householdId, "日用品");
        insertExpense(householdId, userA, categoryId, "500", "Aの支出");
        insertExpense(householdId, userB, categoryId, "700", "Bの支出");

        List<ExpenseEntity> found = expenseMapper.findByPayerUserId(householdId, userA, null);

        assertThat(found).hasSize(1);
        assertThat(found.get(0).getPurpose()).isEqualTo("Aの支出");
    }

    @Test
    void findByPayerUserId_categoryId指定時は絞り込まれる() {
        Long householdId = createHousehold("exp-house3", "EXPCODE0000003");
        Long userId = createUser("payer3@example.com");
        Long categoryId1 = insertCategory(householdId, "食費");
        Long categoryId2 = insertCategory(householdId, "交際費");
        insertExpense(householdId, userId, categoryId1, "300", "食費の支出");
        insertExpense(householdId, userId, categoryId2, "2000", "交際費の支出");

        List<ExpenseEntity> found = expenseMapper.findByPayerUserId(householdId, userId, categoryId1);

        assertThat(found).hasSize(1);
        assertThat(found.get(0).getPurpose()).isEqualTo("食費の支出");
    }

    @Test
    void findByPayerUserId_同じユーザーでも異なる世帯の支出は含まれない() {
        Long oldHouseholdId = createHousehold("old-house", "EXPCODE0000005");
        Long currentHouseholdId = createHousehold("current-house", "EXPCODE0000006");
        Long userId = createUser("moved-payer@example.com");
        Long oldCategoryId = insertCategory(oldHouseholdId, "旧世帯の食費");
        Long currentCategoryId = insertCategory(currentHouseholdId, "現世帯の食費");
        insertExpense(oldHouseholdId, userId, oldCategoryId, "1000", "旧世帯の支出");
        insertExpense(currentHouseholdId, userId, currentCategoryId, "2000", "現世帯の支出");

        List<ExpenseEntity> found =
                expenseMapper.findByPayerUserId(currentHouseholdId, userId, null);

        assertThat(found).hasSize(1);
        assertThat(found.get(0).getHouseholdId()).isEqualTo(currentHouseholdId);
        assertThat(found.get(0).getPurpose()).isEqualTo("現世帯の支出");
    }

    @Test
    void countByCategoryId_使用件数を返す() {
        Long householdId = createHousehold("exp-house4", "EXPCODE0000004");
        Long userId = createUser("payer4@example.com");
        Long categoryId = insertCategory(householdId, "光熱費");
        insertExpense(householdId, userId, categoryId, "100", "電気代");

        int count = expenseMapper.countByCategoryId(categoryId);

        assertThat(count).isEqualTo(1);
    }

    private void insertExpense(Long householdId, Long userId, Long categoryId, String amount, String purpose) {
        expenseMapper.insert(newExpense(householdId, userId, categoryId, amount, purpose));
    }

    private ExpenseEntity newExpense(Long householdId, Long userId, Long categoryId, String amount, String purpose) {
        ExpenseEntity expense = new ExpenseEntity();
        expense.setHouseholdId(householdId);
        expense.setPayerUserId(userId);
        expense.setCategoryId(categoryId);
        expense.setAmount(new BigDecimal(amount));
        expense.setPurpose(purpose);
        expense.setExpenseDate(LocalDate.now());
        expense.setIncludeInHouseholdTotal(false);
        expense.setCreatedAt(LocalDateTime.now());
        return expense;
    }

    private Long insertCategory(Long householdId, String name) {
        KakeiboCategoryEntity category = new KakeiboCategoryEntity();
        category.setHouseholdId(householdId);
        category.setName(name);
        category.setDefault(false);
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

    private Long createUser(String email) {
        jdbcTemplate.update(
                "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
                email, "hash", "テスト太郎", LocalDateTime.now());
        return jdbcTemplate.queryForObject("SELECT id FROM users WHERE email = ?", Long.class, email);
    }
}

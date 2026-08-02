package com.homelog.kakeibo.mapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.homelog.household.entity.HouseholdEntity;
import com.homelog.household.mapper.HouseholdMapper;
import com.homelog.kakeibo.entity.AccountEntity;
import com.homelog.kakeibo.entity.CardEntity;
import com.homelog.kakeibo.entity.ExpenseEntity;
import com.homelog.kakeibo.entity.FixedCostEntity;
import com.homelog.kakeibo.entity.KakeiboCategoryEntity;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DuplicateKeyException;
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
    private AccountMapper accountMapper;

    @Autowired
    private CardMapper cardMapper;

    @Autowired
    private FixedCostMapper fixedCostMapper;

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

    @Test
    void insertAndFindById_card_idを保存できる() {
        Long householdId = createHousehold("exp-house5", "EXPCODE0000007");
        Long userId = createUser("payer5@example.com");
        Long categoryId = insertCategory(householdId, "交通費");
        Long cardId = insertChargeCard(householdId, userId);

        ExpenseEntity expense = newExpense(householdId, userId, categoryId, "500", "電車代");
        expense.setCardId(cardId);
        expenseMapper.insert(expense);

        ExpenseEntity found = expenseMapper.findById(expense.getId());
        assertThat(found.getCardId()).isEqualTo(cardId);
        assertThat(found.getAccountId()).isNull();
    }

    @Test
    void countByCardId_使用件数を返す() {
        Long householdId = createHousehold("exp-house6", "EXPCODE0000008");
        Long userId = createUser("payer6@example.com");
        Long categoryId = insertCategory(householdId, "交通費");
        Long cardId = insertChargeCard(householdId, userId);
        ExpenseEntity expense = newExpense(householdId, userId, categoryId, "500", "電車代");
        expense.setCardId(cardId);
        expenseMapper.insert(expense);

        assertThat(expenseMapper.countByCardId(cardId)).isEqualTo(1);
    }

    @Test
    void countByCardId_使用されていなければ0() {
        Long householdId = createHousehold("exp-house7", "EXPCODE0000009");
        Long userId = createUser("payer7@example.com");
        Long cardId = insertChargeCard(householdId, userId);

        assertThat(expenseMapper.countByCardId(cardId)).isEqualTo(0);
    }

    @Test
    void countByFixedCostIdAndMonth_同一固定費_同月の計上件数を返す() {
        Long householdId = createHousehold("exp-house8", "EXPCODE0000010");
        Long userId = createUser("payer8@example.com");
        Long categoryId = insertCategory(householdId, "固定費");
        Long fixedCostId = insertFixedCost(householdId, userId, "家賃");
        ExpenseEntity expense = newExpense(householdId, userId, categoryId, "80000", "家賃");
        expense.setFixedCostId(fixedCostId);
        expense.setExpenseDate(LocalDate.of(2026, 3, 27));
        expenseMapper.insert(expense);

        int count = expenseMapper.countByFixedCostIdAndMonth(fixedCostId, 2026, 3);

        assertThat(count).isEqualTo(1);
    }

    @Test
    void countByFixedCostIdAndMonth_異なる月の計上は含まれない() {
        Long householdId = createHousehold("exp-house9", "EXPCODE0000011");
        Long userId = createUser("payer9@example.com");
        Long categoryId = insertCategory(householdId, "固定費");
        Long fixedCostId = insertFixedCost(householdId, userId, "家賃");
        ExpenseEntity expense = newExpense(householdId, userId, categoryId, "80000", "家賃");
        expense.setFixedCostId(fixedCostId);
        expense.setExpenseDate(LocalDate.of(2026, 2, 27));
        expenseMapper.insert(expense);

        int count = expenseMapper.countByFixedCostIdAndMonth(fixedCostId, 2026, 3);

        assertThat(count).isEqualTo(0);
    }

    @Test
    void countByFixedCostIdAndMonth_異なる固定費の計上は含まれない() {
        Long householdId = createHousehold("exp-house10", "EXPCODE0000012");
        Long userId = createUser("payer10@example.com");
        Long categoryId = insertCategory(householdId, "固定費");
        Long fixedCostId1 = insertFixedCost(householdId, userId, "家賃");
        Long fixedCostId2 = insertFixedCost(householdId, userId, "水道代");
        ExpenseEntity expense = newExpense(householdId, userId, categoryId, "80000", "家賃");
        expense.setFixedCostId(fixedCostId1);
        expense.setExpenseDate(LocalDate.of(2026, 3, 27));
        expenseMapper.insert(expense);

        int count = expenseMapper.countByFixedCostIdAndMonth(fixedCostId2, 2026, 3);

        assertThat(count).isEqualTo(0);
    }

    @Test
    void insert_同一固定費の同月分が既に存在する場合は一意制約違反になる() {
        Long householdId = createHousehold("exp-house11", "EXPCODE0000013");
        Long userId = createUser("payer11@example.com");
        Long categoryId = insertCategory(householdId, "固定費");
        Long fixedCostId = insertFixedCost(householdId, userId, "家賃");
        ExpenseEntity first = newExpense(householdId, userId, categoryId, "80000", "3月分家賃");
        first.setFixedCostId(fixedCostId);
        first.setFixedCostYearMonth("2026-03");
        first.setExpenseDate(LocalDate.of(2026, 3, 1));
        expenseMapper.insert(first);
        ExpenseEntity duplicate = newExpense(householdId, userId, categoryId, "80000", "3月分家賃");
        duplicate.setFixedCostId(fixedCostId);
        duplicate.setFixedCostYearMonth("2026-03");
        duplicate.setExpenseDate(LocalDate.of(2026, 3, 31));

        assertThatThrownBy(() -> expenseMapper.insert(duplicate))
                .isInstanceOf(DuplicateKeyException.class);
    }

    private Long insertFixedCost(Long householdId, Long userId, String name) {
        FixedCostEntity fixedCost = new FixedCostEntity();
        fixedCost.setHouseholdId(householdId);
        fixedCost.setCreatedByUserId(userId);
        fixedCost.setName(name);
        fixedCost.setAmount(new BigDecimal("80000"));
        fixedCost.setPaymentDay(27);
        fixedCost.setIncludeInHouseholdTotal(false);
        fixedCost.setCreatedAt(LocalDateTime.now());
        fixedCostMapper.insert(fixedCost);
        return fixedCost.getId();
    }

    private Long insertChargeCard(Long householdId, Long userId) {
        AccountEntity account = new AccountEntity();
        account.setHouseholdId(householdId);
        account.setOwnerUserId(userId);
        account.setName("口座");
        account.setType("bank");
        account.setBalance(new BigDecimal("10000"));
        account.setCreatedAt(LocalDateTime.now());
        accountMapper.insert(account);

        CardEntity card = new CardEntity();
        card.setAccountId(account.getId());
        card.setName("チャージカード");
        card.setCardType("charge");
        card.setCreatedAt(LocalDateTime.now());
        cardMapper.insert(card);
        return card.getId();
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

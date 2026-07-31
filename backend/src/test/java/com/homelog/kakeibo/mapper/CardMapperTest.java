package com.homelog.kakeibo.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.homelog.household.entity.HouseholdEntity;
import com.homelog.household.mapper.HouseholdMapper;
import com.homelog.kakeibo.entity.AccountEntity;
import com.homelog.kakeibo.entity.CardEntity;
import java.math.BigDecimal;
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
class CardMapperTest {

    @Autowired
    private CardMapper cardMapper;

    @Autowired
    private AccountMapper accountMapper;

    @Autowired
    private HouseholdMapper householdMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void insertAndFindById_正常系() {
        Long accountId = createAccount();

        CardEntity card = newCard(accountId, "〇〇カード");
        cardMapper.insert(card);

        assertThat(card.getId()).isNotNull();
        CardEntity found = cardMapper.findById(card.getId());
        assertThat(found.getName()).isEqualTo("〇〇カード");
        assertThat(found.getCardType()).isEqualTo("credit");
        assertThat(found.getBalance()).isEqualByComparingTo("0");
    }

    @Test
    void insertAndFindById_charge型カードは指定した種別で登録される() {
        Long accountId = createAccount();

        CardEntity card = newCard(accountId, "Suica");
        card.setCardType("charge");
        cardMapper.insert(card);

        CardEntity found = cardMapper.findById(card.getId());
        assertThat(found.getCardType()).isEqualTo("charge");
        assertThat(found.getBalance()).isEqualByComparingTo("0");
    }

    @Test
    void lockById_行ロックしつつ取得できる() {
        Long accountId = createAccount();
        CardEntity card = newCard(accountId, "チャージカード");
        card.setCardType("charge");
        cardMapper.insert(card);

        CardEntity locked = cardMapper.lockById(card.getId());

        assertThat(locked.getBalance()).isEqualByComparingTo("0");
    }

    @Test
    void updateBalance_残高を更新できる() {
        Long accountId = createAccount();
        CardEntity card = newCard(accountId, "チャージカード");
        card.setCardType("charge");
        cardMapper.insert(card);

        cardMapper.updateBalance(card.getId(), new BigDecimal("3000"));

        assertThat(cardMapper.findById(card.getId()).getBalance()).isEqualByComparingTo("3000");
    }

    @Test
    void findByAccountId_口座に紐づくカードのみ取得できる() {
        Long accountId1 = createAccount();
        Long accountId2 = createAccount();
        cardMapper.insert(newCard(accountId1, "口座1のカード"));
        cardMapper.insert(newCard(accountId2, "口座2のカード"));

        List<CardEntity> found = cardMapper.findByAccountId(accountId1);

        assertThat(found).hasSize(1);
        assertThat(found.get(0).getName()).isEqualTo("口座1のカード");
    }

    @Test
    void update_カード名を更新できる() {
        Long accountId = createAccount();
        CardEntity card = newCard(accountId, "旧カード名");
        cardMapper.insert(card);

        cardMapper.update(card.getId(), "新カード名");

        assertThat(cardMapper.findById(card.getId()).getName()).isEqualTo("新カード名");
    }

    @Test
    void countChargeCardsWithBalanceByAccountId_残高付きchargeカードがあれば1以上() {
        Long accountId = createAccount();
        CardEntity card = newCard(accountId, "チャージカード");
        card.setCardType("charge");
        cardMapper.insert(card);
        cardMapper.updateBalance(card.getId(), new BigDecimal("1000"));

        assertThat(cardMapper.countChargeCardsWithBalanceByAccountId(accountId)).isEqualTo(1);
    }

    @Test
    void countChargeCardsWithBalanceByAccountId_残高0のchargeカードは含まない() {
        Long accountId = createAccount();
        CardEntity card = newCard(accountId, "チャージカード");
        card.setCardType("charge");
        cardMapper.insert(card);

        assertThat(cardMapper.countChargeCardsWithBalanceByAccountId(accountId)).isEqualTo(0);
    }

    @Test
    void countChargeCardsWithBalanceByAccountId_creditカードは残高があっても含まない() {
        Long accountId = createAccount();
        CardEntity card = newCard(accountId, "クレジットカード");
        cardMapper.insert(card);
        cardMapper.updateBalance(card.getId(), new BigDecimal("1000"));

        assertThat(cardMapper.countChargeCardsWithBalanceByAccountId(accountId)).isEqualTo(0);
    }

    @Test
    void delete_カードを削除できる() {
        Long accountId = createAccount();
        CardEntity card = newCard(accountId, "カード");
        cardMapper.insert(card);

        cardMapper.delete(card.getId());

        assertThat(cardMapper.findById(card.getId())).isNull();
    }

    private CardEntity newCard(Long accountId, String name) {
        CardEntity card = new CardEntity();
        card.setAccountId(accountId);
        card.setName(name);
        card.setCardType("credit");
        card.setCreatedAt(LocalDateTime.now());
        return card;
    }

    private Long createAccount() {
        Long householdId = createHousehold();
        Long userId = createUser();
        AccountEntity account = new AccountEntity();
        account.setHouseholdId(householdId);
        account.setOwnerUserId(userId);
        account.setName("口座");
        account.setType("bank");
        account.setBalance(new BigDecimal("1000"));
        account.setCreatedAt(LocalDateTime.now());
        accountMapper.insert(account);
        return account.getId();
    }

    private Long createHousehold() {
        HouseholdEntity household = new HouseholdEntity();
        household.setName("card-house-" + System.nanoTime());
        household.setInviteCode("CARDCODE" + (System.nanoTime() % 100000000L));
        household.setCreatedAt(LocalDateTime.now());
        householdMapper.insert(household);
        return household.getId();
    }

    private Long createUser() {
        String email = "card-owner-" + System.nanoTime() + "@example.com";
        jdbcTemplate.update(
                "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
                email, "hash", "テスト太郎", LocalDateTime.now());
        return jdbcTemplate.queryForObject("SELECT id FROM users WHERE email = ?", Long.class, email);
    }
}

package com.homelog.kakeibo.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.homelog.household.entity.HouseholdEntity;
import com.homelog.household.mapper.HouseholdMapper;
import com.homelog.kakeibo.entity.AccountEntity;
import com.homelog.kakeibo.entity.CardChargeEntity;
import com.homelog.kakeibo.entity.CardEntity;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class CardChargeMapperTest {

    @Autowired
    private CardChargeMapper cardChargeMapper;

    @Autowired
    private CardMapper cardMapper;

    @Autowired
    private AccountMapper accountMapper;

    @Autowired
    private HouseholdMapper householdMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void insert_正常系() {
        Long accountId = createAccount();
        Long cardId = createChargeCard(accountId);

        CardChargeEntity charge = newCharge(cardId, accountId, "3000");
        cardChargeMapper.insert(charge);

        assertThat(charge.getId()).isNotNull();
    }

    @Test
    void countByCardId_チャージ履歴の件数を返す() {
        Long accountId = createAccount();
        Long cardId = createChargeCard(accountId);
        cardChargeMapper.insert(newCharge(cardId, accountId, "1000"));

        assertThat(cardChargeMapper.countByCardId(cardId)).isEqualTo(1);
    }

    @Test
    void countByCardId_チャージ履歴が無ければ0() {
        Long accountId = createAccount();
        Long cardId = createChargeCard(accountId);

        assertThat(cardChargeMapper.countByCardId(cardId)).isEqualTo(0);
    }

    @Test
    void countByFromAccountId_チャージ元口座としての利用件数を返す() {
        Long accountId = createAccount();
        Long cardId = createChargeCard(accountId);
        cardChargeMapper.insert(newCharge(cardId, accountId, "1000"));

        assertThat(cardChargeMapper.countByFromAccountId(accountId)).isEqualTo(1);
    }

    @Test
    void countByFromAccountId_チャージ履歴が無ければ0() {
        Long accountId = createAccount();

        assertThat(cardChargeMapper.countByFromAccountId(accountId)).isEqualTo(0);
    }

    private CardChargeEntity newCharge(Long cardId, Long fromAccountId, String amount) {
        CardChargeEntity charge = new CardChargeEntity();
        charge.setCardId(cardId);
        charge.setFromAccountId(fromAccountId);
        charge.setAmount(new BigDecimal(amount));
        charge.setCreatedAt(LocalDateTime.now());
        return charge;
    }

    private Long createChargeCard(Long accountId) {
        CardEntity card = new CardEntity();
        card.setAccountId(accountId);
        card.setName("チャージカード");
        card.setCardType("charge");
        card.setCreatedAt(LocalDateTime.now());
        cardMapper.insert(card);
        return card.getId();
    }

    private Long createAccount() {
        Long householdId = createHousehold();
        Long userId = createUser();
        AccountEntity account = new AccountEntity();
        account.setHouseholdId(householdId);
        account.setOwnerUserId(userId);
        account.setName("口座");
        account.setType("bank");
        account.setBalance(new BigDecimal("10000"));
        account.setCreatedAt(LocalDateTime.now());
        accountMapper.insert(account);
        return account.getId();
    }

    private Long createHousehold() {
        HouseholdEntity household = new HouseholdEntity();
        household.setName("charge-house-" + System.nanoTime());
        household.setInviteCode("CHGCODE" + (System.nanoTime() % 100000000L));
        household.setCreatedAt(LocalDateTime.now());
        householdMapper.insert(household);
        return household.getId();
    }

    private Long createUser() {
        String email = "charge-owner-" + System.nanoTime() + "@example.com";
        jdbcTemplate.update(
                "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
                email, "hash", "テスト太郎", LocalDateTime.now());
        return jdbcTemplate.queryForObject("SELECT id FROM users WHERE email = ?", Long.class, email);
    }
}

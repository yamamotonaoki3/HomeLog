package com.homelog.kakeibo.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.homelog.household.entity.HouseholdEntity;
import com.homelog.household.mapper.HouseholdMapper;
import com.homelog.kakeibo.entity.AccountEntity;
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
class AccountMapperTest {

    @Autowired
    private AccountMapper accountMapper;

    @Autowired
    private HouseholdMapper householdMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void insertAndFindById_正常系() {
        Long householdId = createHousehold("acc-house", "ACCCODE00000001");
        Long userId = createUser("owner1@example.com");

        AccountEntity account = newAccount(householdId, userId, "〇〇銀行", "bank", "10000");
        accountMapper.insert(account);

        assertThat(account.getId()).isNotNull();
        AccountEntity found = accountMapper.findById(account.getId());
        assertThat(found.getName()).isEqualTo("〇〇銀行");
        assertThat(found.getBalance()).isEqualByComparingTo("10000");
    }

    @Test
    void findByHouseholdIdAndOwnerUserId_自分の口座のみ取得できる_他人の口座は含まれない() {
        Long householdId = createHousehold("acc-house2", "ACCCODE00000002");
        Long userA = createUser("account-a@example.com");
        Long userB = createUser("account-b@example.com");
        insertAccount(householdId, userA, "Aの口座", "bank", "1000");
        insertAccount(householdId, userB, "Bの口座", "bank", "2000");

        List<AccountEntity> found = accountMapper.findByHouseholdIdAndOwnerUserId(householdId, userA);

        assertThat(found).hasSize(1);
        assertThat(found.get(0).getName()).isEqualTo("Aの口座");
    }

    @Test
    void findByHouseholdIdAndOwnerUserId_同じユーザーでも異なる世帯の口座は含まれない() {
        Long oldHouseholdId = createHousehold("acc-old-house", "ACCCODE00000005");
        Long currentHouseholdId = createHousehold("acc-current-house", "ACCCODE00000006");
        Long userId = createUser("moved-owner@example.com");
        insertAccount(oldHouseholdId, userId, "旧世帯の口座", "bank", "1000");
        insertAccount(currentHouseholdId, userId, "現世帯の口座", "bank", "2000");

        List<AccountEntity> found = accountMapper.findByHouseholdIdAndOwnerUserId(currentHouseholdId, userId);

        assertThat(found).hasSize(1);
        assertThat(found.get(0).getHouseholdId()).isEqualTo(currentHouseholdId);
        assertThat(found.get(0).getName()).isEqualTo("現世帯の口座");
    }

    @Test
    void update_名前と種別を更新できる() {
        Long householdId = createHousehold("acc-house3", "ACCCODE00000003");
        Long userId = createUser("owner3@example.com");
        AccountEntity account = newAccount(householdId, userId, "旧名義", "bank", "1000");
        accountMapper.insert(account);

        accountMapper.update(account.getId(), "新名義", "e_money");

        AccountEntity found = accountMapper.findById(account.getId());
        assertThat(found.getName()).isEqualTo("新名義");
        assertThat(found.getType()).isEqualTo("e_money");
    }

    @Test
    void updateBalance_単発の支出上限を超える桁数の累積減算後残高でも更新できる() {
        Long householdId = createHousehold("acc-house7", "ACCCODE00000009");
        Long userId = createUser("owner7@example.com");
        AccountEntity account = newAccount(householdId, userId, "口座", "bank", "0");
        accountMapper.insert(account);

        accountMapper.updateBalance(account.getId(), new BigDecimal("-12345678901"));

        AccountEntity found = accountMapper.findById(account.getId());
        assertThat(found.getBalance()).isEqualByComparingTo("-12345678901");
    }

    @Test
    void updateBalance_残高を更新できる() {
        Long householdId = createHousehold("acc-house4", "ACCCODE00000004");
        Long userId = createUser("owner4@example.com");
        AccountEntity account = newAccount(householdId, userId, "口座", "bank", "10000");
        accountMapper.insert(account);

        accountMapper.updateBalance(account.getId(), new BigDecimal("7000"));

        AccountEntity found = accountMapper.findById(account.getId());
        assertThat(found.getBalance()).isEqualByComparingTo("7000");
    }

    @Test
    void lockById_行ロックしつつ取得できる() {
        Long householdId = createHousehold("acc-house5", "ACCCODE00000007");
        Long userId = createUser("owner5@example.com");
        AccountEntity account = newAccount(householdId, userId, "口座", "bank", "10000");
        accountMapper.insert(account);

        AccountEntity locked = accountMapper.lockById(account.getId());

        assertThat(locked.getBalance()).isEqualByComparingTo("10000");
    }

    @Test
    void delete_口座を削除できる() {
        Long householdId = createHousehold("acc-house6", "ACCCODE00000008");
        Long userId = createUser("owner6@example.com");
        AccountEntity account = newAccount(householdId, userId, "口座", "bank", "10000");
        accountMapper.insert(account);

        accountMapper.delete(account.getId());

        assertThat(accountMapper.findById(account.getId())).isNull();
    }

    private void insertAccount(Long householdId, Long userId, String name, String type, String balance) {
        accountMapper.insert(newAccount(householdId, userId, name, type, balance));
    }

    private AccountEntity newAccount(Long householdId, Long userId, String name, String type, String balance) {
        AccountEntity account = new AccountEntity();
        account.setHouseholdId(householdId);
        account.setOwnerUserId(userId);
        account.setName(name);
        account.setType(type);
        account.setBalance(new BigDecimal(balance));
        account.setCreatedAt(LocalDateTime.now());
        return account;
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

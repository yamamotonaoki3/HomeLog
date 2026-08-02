package com.homelog.kakeibo.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.homelog.household.entity.HouseholdEntity;
import com.homelog.household.mapper.HouseholdMapper;
import com.homelog.kakeibo.entity.FixedCostEntity;
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
class FixedCostMapperTest {

    @Autowired
    private FixedCostMapper fixedCostMapper;

    @Autowired
    private HouseholdMapper householdMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void insertAndFindById_正常系() {
        Long householdId = createHousehold("fc-house1", "FCCODE00000001");
        Long userId = createUser("owner1@example.com");

        FixedCostEntity fixedCost = newFixedCost(householdId, userId, userId, "家賃", "80000", 27);
        fixedCostMapper.insert(fixedCost);

        assertThat(fixedCost.getId()).isNotNull();
        FixedCostEntity found = fixedCostMapper.findById(fixedCost.getId());
        assertThat(found.getName()).isEqualTo("家賃");
        assertThat(found.getAmount()).isEqualByComparingTo("80000");
        assertThat(found.getPaymentDay()).isEqualTo(27);
        assertThat(found.getOwnerUserId()).isEqualTo(userId);
        assertThat(found.getCreatedByUserId()).isEqualTo(userId);
    }

    @Test
    void insertAndFindById_世帯共有はowner_user_idがnullで登録できる() {
        Long householdId = createHousehold("fc-house2", "FCCODE00000002");
        Long userId = createUser("owner2@example.com");

        FixedCostEntity fixedCost = newFixedCost(householdId, null, userId, "水道代", "3000", 15);
        fixedCostMapper.insert(fixedCost);

        FixedCostEntity found = fixedCostMapper.findById(fixedCost.getId());
        assertThat(found.getOwnerUserId()).isNull();
        assertThat(found.getCreatedByUserId()).isEqualTo(userId);
    }

    @Test
    void findVisibleByHouseholdIdAndUserId_世帯共有は全員閲覧できる() {
        Long householdId = createHousehold("fc-house3", "FCCODE00000003");
        Long userA = createUser("fc-a@example.com");
        Long userB = createUser("fc-b@example.com");
        fixedCostMapper.insert(newFixedCost(householdId, null, userA, "家賃", "80000", 27));

        List<FixedCostEntity> foundByB = fixedCostMapper.findVisibleByHouseholdIdAndUserId(householdId, userB);

        assertThat(foundByB).hasSize(1);
        assertThat(foundByB.get(0).getName()).isEqualTo("家賃");
    }

    @Test
    void findVisibleByHouseholdIdAndUserId_個人所有は本人以外に見えない() {
        Long householdId = createHousehold("fc-house4", "FCCODE00000004");
        Long userA = createUser("fc-a2@example.com");
        Long userB = createUser("fc-b2@example.com");
        fixedCostMapper.insert(newFixedCost(householdId, userA, userA, "Aの個人サブスク", "1000", 10));

        List<FixedCostEntity> foundByA = fixedCostMapper.findVisibleByHouseholdIdAndUserId(householdId, userA);
        List<FixedCostEntity> foundByB = fixedCostMapper.findVisibleByHouseholdIdAndUserId(householdId, userB);

        assertThat(foundByA).hasSize(1);
        assertThat(foundByB).isEmpty();
    }

    @Test
    void findVisibleByHouseholdIdAndUserId_異なる世帯の固定費は含まれない() {
        Long householdId1 = createHousehold("fc-house5", "FCCODE00000005");
        Long householdId2 = createHousehold("fc-house6", "FCCODE00000006");
        Long userId = createUser("fc-c@example.com");
        fixedCostMapper.insert(newFixedCost(householdId1, null, userId, "旧世帯の固定費", "1000", 10));

        List<FixedCostEntity> found = fixedCostMapper.findVisibleByHouseholdIdAndUserId(householdId2, userId);

        assertThat(found).isEmpty();
    }

    @Test
    void update_名前と金額と支払日と公開範囲を更新できる() {
        Long householdId = createHousehold("fc-house7", "FCCODE00000007");
        Long userId = createUser("owner7@example.com");
        FixedCostEntity fixedCost = newFixedCost(householdId, userId, userId, "旧名称", "1000", 10);
        fixedCostMapper.insert(fixedCost);

        fixedCostMapper.update(fixedCost.getId(), "新名称", new BigDecimal("2000"), 20, null, true);

        FixedCostEntity found = fixedCostMapper.findById(fixedCost.getId());
        assertThat(found.getName()).isEqualTo("新名称");
        assertThat(found.getAmount()).isEqualByComparingTo("2000");
        assertThat(found.getPaymentDay()).isEqualTo(20);
        assertThat(found.getOwnerUserId()).isNull();
        assertThat(found.isIncludeInHouseholdTotal()).isTrue();
    }

    @Test
    void delete_固定費を削除できる() {
        Long householdId = createHousehold("fc-house8", "FCCODE00000008");
        Long userId = createUser("owner8@example.com");
        FixedCostEntity fixedCost = newFixedCost(householdId, userId, userId, "固定費", "1000", 10);
        fixedCostMapper.insert(fixedCost);

        fixedCostMapper.delete(fixedCost.getId());

        assertThat(fixedCostMapper.findById(fixedCost.getId())).isNull();
    }

    @Test
    void findDueForPosting_支払日が当日と一致する固定費を抽出する() {
        Long householdId = createHousehold("fc-house9", "FCCODE00000009");
        Long userId = createUser("owner9@example.com");
        fixedCostMapper.insert(newFixedCost(householdId, null, userId, "支払日一致", "1000", 27));
        fixedCostMapper.insert(newFixedCost(householdId, null, userId, "支払日不一致", "1000", 26));

        List<FixedCostEntity> found = fixedCostMapper.findDueForPosting(27, 31);

        assertThat(found).extracting(FixedCostEntity::getName).containsExactly("支払日一致");
    }

    @Test
    void findDueForPosting_月末クランプ対象の固定費を抽出する() {
        Long householdId = createHousehold("fc-house10", "FCCODE00000010");
        Long userId = createUser("owner10@example.com");
        fixedCostMapper.insert(newFixedCost(householdId, null, userId, "31日払い", "1000", 31));

        List<FixedCostEntity> found = fixedCostMapper.findDueForPosting(28, 28);

        assertThat(found).extracting(FixedCostEntity::getName).containsExactly("31日払い");
    }

    @Test
    void findDueForPosting_当月に存在する支払日はクランプ対象にならない() {
        Long householdId = createHousehold("fc-house11", "FCCODE00000011");
        Long userId = createUser("owner11@example.com");
        fixedCostMapper.insert(newFixedCost(householdId, null, userId, "30日払い", "1000", 30));

        List<FixedCostEntity> found = fixedCostMapper.findDueForPosting(29, 30);

        assertThat(found).isEmpty();
    }

    @Test
    void findDueForPosting_複数世帯にまたがる対象を全て抽出する() {
        Long householdId1 = createHousehold("fc-house12", "FCCODE00000012");
        Long householdId2 = createHousehold("fc-house13", "FCCODE00000013");
        Long userId1 = createUser("owner12@example.com");
        Long userId2 = createUser("owner13@example.com");
        fixedCostMapper.insert(newFixedCost(householdId1, null, userId1, "世帯1の固定費", "1000", 15));
        fixedCostMapper.insert(newFixedCost(householdId2, null, userId2, "世帯2の固定費", "1000", 15));

        List<FixedCostEntity> found = fixedCostMapper.findDueForPosting(15, 31);

        assertThat(found).extracting(FixedCostEntity::getName)
                .containsExactlyInAnyOrder("世帯1の固定費", "世帯2の固定費");
    }

    private FixedCostEntity newFixedCost(Long householdId, Long ownerUserId, Long createdByUserId, String name,
            String amount, int paymentDay) {
        FixedCostEntity fixedCost = new FixedCostEntity();
        fixedCost.setHouseholdId(householdId);
        fixedCost.setOwnerUserId(ownerUserId);
        fixedCost.setCreatedByUserId(createdByUserId);
        fixedCost.setName(name);
        fixedCost.setAmount(new BigDecimal(amount));
        fixedCost.setPaymentDay(paymentDay);
        fixedCost.setIncludeInHouseholdTotal(false);
        fixedCost.setCreatedAt(LocalDateTime.now());
        return fixedCost;
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

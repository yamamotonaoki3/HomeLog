package com.homelog.household.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.homelog.household.entity.HouseholdEntity;
import com.homelog.household.entity.HouseholdMemberEntity;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class HouseholdMapperTest {

    @Autowired
    private HouseholdMapper householdMapper;

    @Autowired
    private HouseholdMemberMapper householdMemberMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void insertAndFindById_正常系() {
        HouseholdEntity household = newHousehold("山田家", "AB12CD34EF56GH78");

        householdMapper.insert(household);

        assertThat(household.getId()).isNotNull();
        HouseholdEntity found = householdMapper.findById(household.getId());
        assertThat(found.getName()).isEqualTo("山田家");
        assertThat(found.getInviteCode()).isEqualTo("AB12CD34EF56GH78");
    }

    @Test
    void findByInviteCode_正常系() {
        HouseholdEntity household = newHousehold("鈴木家", "ZZ99YY88XX77WW66");
        householdMapper.insert(household);

        HouseholdEntity found = householdMapper.findByInviteCode("ZZ99YY88XX77WW66");

        assertThat(found).isNotNull();
        assertThat(found.getId()).isEqualTo(household.getId());
    }

    @Test
    void findByInviteCode_該当なしはnullを返す() {
        HouseholdEntity found = householdMapper.findByInviteCode("NOT-EXIST-CODE");

        assertThat(found).isNull();
    }

    @Test
    void updateInviteCode_正常系() {
        HouseholdEntity household = newHousehold("佐藤家", "OLD1234567890ABC");
        householdMapper.insert(household);

        householdMapper.updateInviteCode(household.getId(), "NEW1234567890XYZ");

        HouseholdEntity found = householdMapper.findById(household.getId());
        assertThat(found.getInviteCode()).isEqualTo("NEW1234567890XYZ");
    }

    @Test
    void delete_正常系() {
        HouseholdEntity household = newHousehold("削除家", "DELETEHOUSE00001");
        householdMapper.insert(household);

        householdMapper.delete(household.getId());

        assertThat(householdMapper.findById(household.getId())).isNull();
    }

    @Test
    void delete_CASCADEで在庫等の関連データも削除される() {
        HouseholdEntity household = newHousehold("カスケード家", "CASCADEHOUSE0001");
        householdMapper.insert(household);
        Long householdId = household.getId();
        Long userId = createUser("cascade@example.com");
        HouseholdMemberEntity member = new HouseholdMemberEntity();
        member.setHouseholdId(householdId);
        member.setUserId(userId);
        member.setJoinedAt(LocalDateTime.now());
        householdMemberMapper.insert(member);
        Long categoryId = insertAndGetId(
                "INSERT INTO zaiko_categories (household_id, name, is_default) VALUES (?, ?, ?)",
                householdId, "野菜", false);
        Long itemId = insertAndGetId(
                "INSERT INTO inventory_items (household_id, name, category_id, quantity, threshold) "
                        + "VALUES (?, ?, ?, ?, ?)",
                householdId, "トマト", categoryId, 1, 1);
        jdbcTemplate.update(
                "INSERT INTO shopping_list_items (household_id, inventory_item_id, is_manual, purchased) "
                        + "VALUES (?, ?, ?, ?)",
                householdId, itemId, true, false);

        householdMapper.delete(householdId);

        assertThat(householdMemberMapper.findByUserId(userId)).isNull();
        Integer categoryCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM zaiko_categories WHERE household_id = ?", Integer.class, householdId);
        Integer itemCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM inventory_items WHERE household_id = ?", Integer.class, householdId);
        Integer shoppingCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM shopping_list_items WHERE household_id = ?", Integer.class, householdId);
        assertThat(categoryCount).isZero();
        assertThat(itemCount).isZero();
        assertThat(shoppingCount).isZero();
    }

    private Long insertAndGetId(String sql, Object... args) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbcTemplate.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
            for (int i = 0; i < args.length; i++) {
                ps.setObject(i + 1, args[i]);
            }
            return ps;
        }, keyHolder);
        return keyHolder.getKey().longValue();
    }

    private Long createUser(String email) {
        jdbcTemplate.update(
                "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
                email, "hash", "太郎", LocalDateTime.now());
        return jdbcTemplate.queryForObject("SELECT id FROM users WHERE email = ?", Long.class, email);
    }

    private HouseholdEntity newHousehold(String name, String inviteCode) {
        HouseholdEntity household = new HouseholdEntity();
        household.setName(name);
        household.setInviteCode(inviteCode);
        household.setCreatedAt(LocalDateTime.now());
        return household;
    }
}

package com.homelog.household.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.homelog.household.entity.HouseholdEntity;
import com.homelog.household.entity.HouseholdMemberEntity;
import com.homelog.household.entity.MemberSummaryEntity;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class HouseholdMemberMapperTest {

    @Autowired
    private HouseholdMemberMapper householdMemberMapper;

    @Autowired
    private HouseholdMapper householdMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void insertAndFindByUserId_正常系() {
        Long householdId = createHousehold("insert-house", "INSERTCODE000001");
        Long userId = createUser("member1@example.com");
        HouseholdMemberEntity member = new HouseholdMemberEntity();
        member.setHouseholdId(householdId);
        member.setUserId(userId);
        member.setJoinedAt(LocalDateTime.now());

        householdMemberMapper.insert(member);

        HouseholdMemberEntity found = householdMemberMapper.findByUserId(userId);
        assertThat(found).isNotNull();
        assertThat(found.getHouseholdId()).isEqualTo(householdId);
    }

    @Test
    void findByUserId_未所属はnullを返す() {
        HouseholdMemberEntity found = householdMemberMapper.findByUserId(999999L);

        assertThat(found).isNull();
    }

    @Test
    void insert_同一ユーザーの2件目はユニーク制約違反になる() {
        Long householdId = createHousehold("dup-house", "DUPCODE000000001");
        Long userId = createUser("dup@example.com");
        HouseholdMemberEntity first = new HouseholdMemberEntity();
        first.setHouseholdId(householdId);
        first.setUserId(userId);
        first.setJoinedAt(LocalDateTime.now());
        householdMemberMapper.insert(first);

        HouseholdMemberEntity second = new HouseholdMemberEntity();
        second.setHouseholdId(householdId);
        second.setUserId(userId);
        second.setJoinedAt(LocalDateTime.now());

        assertThatThrownBy(() -> householdMemberMapper.insert(second))
                .isInstanceOf(DuplicateKeyException.class);
    }

    @Test
    void findMemberSummariesByHouseholdId_表示名付きで取得できる() {
        Long householdId = createHousehold("summary-house", "SUMMARYCODE00001");
        Long userId = createUser("summary@example.com", "サマリー太郎");
        HouseholdMemberEntity member = new HouseholdMemberEntity();
        member.setHouseholdId(householdId);
        member.setUserId(userId);
        member.setJoinedAt(LocalDateTime.now());
        householdMemberMapper.insert(member);

        List<MemberSummaryEntity> summaries = householdMemberMapper.findMemberSummariesByHouseholdId(householdId);

        assertThat(summaries).hasSize(1);
        assertThat(summaries.get(0).getUserId()).isEqualTo(userId);
        assertThat(summaries.get(0).getDisplayName()).isEqualTo("サマリー太郎");
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
        return createUser(email, "太郎");
    }

    private Long createUser(String email, String displayName) {
        jdbcTemplate.update(
                "INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
                email, "hash", displayName, LocalDateTime.now());
        return jdbcTemplate.queryForObject("SELECT id FROM users WHERE email = ?", Long.class, email);
    }
}

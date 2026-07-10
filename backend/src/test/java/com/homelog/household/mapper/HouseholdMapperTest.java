package com.homelog.household.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.homelog.household.entity.HouseholdEntity;
import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class HouseholdMapperTest {

    @Autowired
    private HouseholdMapper householdMapper;

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

    private HouseholdEntity newHousehold(String name, String inviteCode) {
        HouseholdEntity household = new HouseholdEntity();
        household.setName(name);
        household.setInviteCode(inviteCode);
        household.setCreatedAt(LocalDateTime.now());
        return household;
    }
}

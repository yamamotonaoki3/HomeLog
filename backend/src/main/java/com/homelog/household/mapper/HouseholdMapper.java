package com.homelog.household.mapper;

import com.homelog.household.entity.HouseholdEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface HouseholdMapper {

    void insert(HouseholdEntity household);

    HouseholdEntity findById(Long id);

    HouseholdEntity findByInviteCode(String inviteCode);

    void updateInviteCode(@Param("id") Long id, @Param("inviteCode") String inviteCode);
}

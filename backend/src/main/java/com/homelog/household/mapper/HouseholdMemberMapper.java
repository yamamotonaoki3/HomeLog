package com.homelog.household.mapper;

import com.homelog.household.entity.HouseholdMemberEntity;
import com.homelog.household.entity.MemberSummaryEntity;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface HouseholdMemberMapper {

    void insert(HouseholdMemberEntity member);

    HouseholdMemberEntity findByUserId(Long userId);

    List<Long> lockByHouseholdId(Long householdId);

    List<MemberSummaryEntity> findMemberSummariesByHouseholdId(Long householdId);

    void delete(Long userId);

    int countByHouseholdId(Long householdId);
}

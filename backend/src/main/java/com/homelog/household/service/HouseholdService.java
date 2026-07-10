package com.homelog.household.service;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.DuplicateResourceException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.common.util.InviteCodeGenerator;
import com.homelog.household.dto.request.CreateHouseholdRequest;
import com.homelog.household.dto.request.JoinHouseholdRequest;
import com.homelog.household.dto.response.HouseholdCreateResponse;
import com.homelog.household.dto.response.HouseholdJoinResponse;
import com.homelog.household.dto.response.HouseholdMeResponse;
import com.homelog.household.dto.response.InviteCodeResponse;
import com.homelog.household.dto.response.MemberResponse;
import com.homelog.household.entity.HouseholdEntity;
import com.homelog.household.entity.HouseholdMemberEntity;
import com.homelog.household.mapper.HouseholdMapper;
import com.homelog.household.mapper.HouseholdMemberMapper;
import java.time.LocalDateTime;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class HouseholdService {

    private static final String ALREADY_HAS_HOUSEHOLD_MESSAGE = "既にいずれかの世帯グループに所属しています";
    private static final String NOT_FOUND_MESSAGE = "世帯グループが見つかりません";
    private static final String INVITE_CODE_GENERATION_FAILED_MESSAGE = "招待コードの生成に失敗しました。再度お試しください";
    private static final int INVITE_CODE_MAX_RETRIES = 5;

    private final HouseholdMapper householdMapper;
    private final HouseholdMemberMapper householdMemberMapper;

    public HouseholdService(HouseholdMapper householdMapper, HouseholdMemberMapper householdMemberMapper) {
        this.householdMapper = householdMapper;
        this.householdMemberMapper = householdMemberMapper;
    }

    @Transactional
    public HouseholdCreateResponse createHousehold(Long userId, CreateHouseholdRequest request) {
        if (householdMemberMapper.findByUserId(userId) != null) {
            throw new BadRequestException(ALREADY_HAS_HOUSEHOLD_MESSAGE);
        }
        HouseholdEntity household = new HouseholdEntity();
        household.setName(request.name());
        household.setCreatedAt(LocalDateTime.now());
        insertWithUniqueInviteCode(household);
        addMember(household.getId(), userId);
        return new HouseholdCreateResponse(household.getId(), household.getName(), household.getInviteCode());
    }

    @Transactional
    public HouseholdJoinResponse joinHousehold(Long userId, JoinHouseholdRequest request) {
        if (householdMemberMapper.findByUserId(userId) != null) {
            throw new BadRequestException(ALREADY_HAS_HOUSEHOLD_MESSAGE);
        }
        HouseholdEntity household = householdMapper.findByInviteCode(request.inviteCode());
        if (household == null) {
            // コード誤りと期限切れを区別しない（api-design.md 3章参照、招待コード探索対策）
            throw new ResourceNotFoundException("招待コードが無効です");
        }
        addMember(household.getId(), userId);
        return new HouseholdJoinResponse(household.getId(), household.getName());
    }

    public HouseholdMeResponse getMyHousehold(Long userId) {
        HouseholdMemberEntity member = householdMemberMapper.findByUserId(userId);
        if (member == null) {
            throw new ResourceNotFoundException(NOT_FOUND_MESSAGE);
        }
        HouseholdEntity household = householdMapper.findById(member.getHouseholdId());
        var members = householdMemberMapper.findMemberSummariesByHouseholdId(household.getId()).stream()
                .map(summary -> new MemberResponse(summary.getUserId(), summary.getDisplayName()))
                .toList();
        return new HouseholdMeResponse(household.getId(), household.getName(), household.getInviteCode(), members);
    }

    @Transactional
    public InviteCodeResponse regenerateInviteCode(Long userId) {
        HouseholdMemberEntity member = householdMemberMapper.findByUserId(userId);
        if (member == null) {
            throw new ResourceNotFoundException(NOT_FOUND_MESSAGE);
        }
        String newCode = updateWithUniqueInviteCode(member.getHouseholdId());
        return new InviteCodeResponse(newCode);
    }

    private void insertWithUniqueInviteCode(HouseholdEntity household) {
        household.setInviteCode(generateUniqueInviteCode());
        try {
            householdMapper.insert(household);
        } catch (DuplicateKeyException ex) {
            throw new DuplicateResourceException(INVITE_CODE_GENERATION_FAILED_MESSAGE);
        }
    }

    private String updateWithUniqueInviteCode(Long householdId) {
        String inviteCode = generateUniqueInviteCode();
        try {
            householdMapper.updateInviteCode(householdId, inviteCode);
            return inviteCode;
        } catch (DuplicateKeyException ex) {
            throw new DuplicateResourceException(INVITE_CODE_GENERATION_FAILED_MESSAGE);
        }
    }

    private String generateUniqueInviteCode() {
        for (int attempt = 1; attempt <= INVITE_CODE_MAX_RETRIES; attempt++) {
            String inviteCode = InviteCodeGenerator.generate();
            if (householdMapper.findByInviteCode(inviteCode) == null) {
                return inviteCode;
            }
        }
        throw new DuplicateResourceException(INVITE_CODE_GENERATION_FAILED_MESSAGE);
    }

    private void addMember(Long householdId, Long userId) {
        HouseholdMemberEntity member = new HouseholdMemberEntity();
        member.setHouseholdId(householdId);
        member.setUserId(userId);
        member.setJoinedAt(LocalDateTime.now());
        try {
            householdMemberMapper.insert(member);
        } catch (DuplicateKeyException ex) {
            // 事前チェックとinsertの間で同時に別の世帯へ参加/作成した場合の競合を防ぐ
            // （DBのUNIQUE制約：household_members.user_idを最終防衛線とする）
            throw new BadRequestException(ALREADY_HAS_HOUSEHOLD_MESSAGE);
        }
    }
}

package com.homelog.household.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.DuplicateResourceException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.dto.request.CreateHouseholdRequest;
import com.homelog.household.dto.request.JoinHouseholdRequest;
import com.homelog.household.dto.response.HouseholdCreateResponse;
import com.homelog.household.dto.response.HouseholdJoinResponse;
import com.homelog.household.dto.response.HouseholdMeResponse;
import com.homelog.household.dto.response.InviteCodeResponse;
import com.homelog.household.entity.HouseholdEntity;
import com.homelog.household.entity.HouseholdMemberEntity;
import com.homelog.household.entity.MemberSummaryEntity;
import com.homelog.household.mapper.HouseholdMapper;
import com.homelog.household.mapper.HouseholdMemberMapper;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DuplicateKeyException;

@ExtendWith(MockitoExtension.class)
class HouseholdServiceTest {

    @Mock
    private HouseholdMapper householdMapper;
    @Mock
    private HouseholdMemberMapper householdMemberMapper;

    private HouseholdService householdService;

    private HouseholdService service() {
        return new HouseholdService(householdMapper, householdMemberMapper);
    }

    @Test
    void createHousehold_正常系() {
        householdService = service();
        when(householdMemberMapper.findByUserId(1L)).thenReturn(null);

        HouseholdCreateResponse response = householdService.createHousehold(1L, new CreateHouseholdRequest("山田家"));

        assertThat(response.name()).isEqualTo("山田家");
        assertThat(response.inviteCode()).isNotBlank();
        verify(householdMapper).insert(any(HouseholdEntity.class));
        verify(householdMemberMapper).insert(any(HouseholdMemberEntity.class));
    }

    @Test
    void createHousehold_既に所属している場合は400() {
        householdService = service();
        when(householdMemberMapper.findByUserId(1L)).thenReturn(new HouseholdMemberEntity());

        assertThatThrownBy(() -> householdService.createHousehold(1L, new CreateHouseholdRequest("山田家")))
                .isInstanceOf(BadRequestException.class);
        verify(householdMapper, org.mockito.Mockito.never()).insert(any());
    }

    @Test
    void createHousehold_同時作成でDB制約違反も400として扱う() {
        householdService = service();
        when(householdMemberMapper.findByUserId(1L)).thenReturn(null);
        org.mockito.Mockito.doThrow(new DuplicateKeyException("duplicate"))
                .when(householdMemberMapper).insert(any());

        assertThatThrownBy(() -> householdService.createHousehold(1L, new CreateHouseholdRequest("山田家")))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void createHousehold_招待コード重複時は再生成してリトライする() {
        householdService = service();
        when(householdMemberMapper.findByUserId(1L)).thenReturn(null);
        when(householdMapper.findByInviteCode(any()))
                .thenReturn(new HouseholdEntity(), (HouseholdEntity) null);
        org.mockito.Mockito.doAnswer(invocation -> {
            HouseholdEntity household = invocation.getArgument(0);
            household.setId(10L);
            return null;
        })
                .when(householdMapper).insert(any(HouseholdEntity.class));

        HouseholdCreateResponse response = householdService.createHousehold(1L, new CreateHouseholdRequest("山田家"));

        assertThat(response.id()).isEqualTo(10L);
        assertThat(response.inviteCode()).hasSize(16);
        verify(householdMapper, org.mockito.Mockito.times(2)).findByInviteCode(any());
        verify(householdMapper).insert(any(HouseholdEntity.class));
        verify(householdMemberMapper).insert(any(HouseholdMemberEntity.class));
    }

    @Test
    void createHousehold_招待コード重複が上限回数続く場合は409() {
        householdService = service();
        when(householdMemberMapper.findByUserId(1L)).thenReturn(null);
        when(householdMapper.findByInviteCode(any())).thenReturn(new HouseholdEntity());

        assertThatThrownBy(() -> householdService.createHousehold(1L, new CreateHouseholdRequest("山田家")))
                .isInstanceOf(DuplicateResourceException.class);
        verify(householdMapper, org.mockito.Mockito.times(5)).findByInviteCode(any());
        verify(householdMapper, org.mockito.Mockito.never()).insert(any(HouseholdEntity.class));
        verify(householdMemberMapper, org.mockito.Mockito.never()).insert(any(HouseholdMemberEntity.class));
    }

    @Test
    void createHousehold_招待コードがDB制約で競合した場合は409() {
        householdService = service();
        when(householdMemberMapper.findByUserId(1L)).thenReturn(null);
        when(householdMapper.findByInviteCode(any())).thenReturn(null);
        org.mockito.Mockito.doThrow(new DuplicateKeyException("duplicate invite_code"))
                .when(householdMapper).insert(any(HouseholdEntity.class));

        assertThatThrownBy(() -> householdService.createHousehold(1L, new CreateHouseholdRequest("山田家")))
                .isInstanceOf(DuplicateResourceException.class);
        verify(householdMemberMapper, org.mockito.Mockito.never()).insert(any(HouseholdMemberEntity.class));
    }

    @Test
    void joinHousehold_正常系() {
        householdService = service();
        when(householdMemberMapper.findByUserId(2L)).thenReturn(null);
        HouseholdEntity household = new HouseholdEntity();
        household.setId(10L);
        household.setName("山田家");
        household.setInviteCode("AB12CD34EF56GH78");
        when(householdMapper.findByInviteCode("AB12CD34EF56GH78")).thenReturn(household);

        HouseholdJoinResponse response = householdService.joinHousehold(2L,
                new JoinHouseholdRequest("AB12CD34EF56GH78"));

        assertThat(response.id()).isEqualTo(10L);
        assertThat(response.name()).isEqualTo("山田家");
        verify(householdMemberMapper).insert(any(HouseholdMemberEntity.class));
    }

    @Test
    void joinHousehold_既に所属している場合は400() {
        householdService = service();
        when(householdMemberMapper.findByUserId(2L)).thenReturn(new HouseholdMemberEntity());

        assertThatThrownBy(() -> householdService.joinHousehold(2L, new JoinHouseholdRequest("AB12CD34EF56GH78")))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void joinHousehold_招待コードが存在しない場合は404() {
        householdService = service();
        when(householdMemberMapper.findByUserId(2L)).thenReturn(null);
        when(householdMapper.findByInviteCode("UNKNOWN")).thenReturn(null);

        assertThatThrownBy(() -> householdService.joinHousehold(2L, new JoinHouseholdRequest("UNKNOWN")))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void getMyHousehold_正常系() {
        householdService = service();
        HouseholdMemberEntity member = new HouseholdMemberEntity();
        member.setHouseholdId(10L);
        when(householdMemberMapper.findByUserId(1L)).thenReturn(member);
        HouseholdEntity household = new HouseholdEntity();
        household.setId(10L);
        household.setName("山田家");
        household.setInviteCode("AB12CD34EF56GH78");
        when(householdMapper.findById(10L)).thenReturn(household);
        MemberSummaryEntity summary = new MemberSummaryEntity();
        summary.setUserId(1L);
        summary.setDisplayName("太郎");
        when(householdMemberMapper.findMemberSummariesByHouseholdId(10L)).thenReturn(List.of(summary));

        HouseholdMeResponse response = householdService.getMyHousehold(1L);

        assertThat(response.id()).isEqualTo(10L);
        assertThat(response.inviteCode()).isEqualTo("AB12CD34EF56GH78");
        assertThat(response.members()).hasSize(1);
        assertThat(response.members().get(0).displayName()).isEqualTo("太郎");
    }

    @Test
    void getMyHousehold_未所属の場合は404() {
        householdService = service();
        when(householdMemberMapper.findByUserId(1L)).thenReturn(null);

        assertThatThrownBy(() -> householdService.getMyHousehold(1L))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void regenerateInviteCode_正常系() {
        householdService = service();
        HouseholdMemberEntity member = new HouseholdMemberEntity();
        member.setHouseholdId(10L);
        when(householdMemberMapper.findByUserId(1L)).thenReturn(member);

        InviteCodeResponse response = householdService.regenerateInviteCode(1L);

        assertThat(response.inviteCode()).isNotBlank();
        verify(householdMapper).updateInviteCode(org.mockito.ArgumentMatchers.eq(10L), any());
    }

    @Test
    void regenerateInviteCode_招待コード重複時は再生成してリトライする() {
        householdService = service();
        HouseholdMemberEntity member = new HouseholdMemberEntity();
        member.setHouseholdId(10L);
        when(householdMemberMapper.findByUserId(1L)).thenReturn(member);
        when(householdMapper.findByInviteCode(any()))
                .thenReturn(new HouseholdEntity(), (HouseholdEntity) null);
        List<String> updatedInviteCodes = new ArrayList<>();
        org.mockito.Mockito.doAnswer(invocation -> {
            updatedInviteCodes.add(invocation.getArgument(1, String.class));
            return null;
        })
                .when(householdMapper).updateInviteCode(anyLong(), any());

        InviteCodeResponse response = householdService.regenerateInviteCode(1L);

        assertThat(response.inviteCode()).isEqualTo(updatedInviteCodes.get(0));
        assertThat(response.inviteCode()).hasSize(16);
        verify(householdMapper, org.mockito.Mockito.times(2)).findByInviteCode(any());
        verify(householdMapper).updateInviteCode(anyLong(), any());
    }

    @Test
    void regenerateInviteCode_招待コード重複が上限回数続く場合は409() {
        householdService = service();
        HouseholdMemberEntity member = new HouseholdMemberEntity();
        member.setHouseholdId(10L);
        when(householdMemberMapper.findByUserId(1L)).thenReturn(member);
        when(householdMapper.findByInviteCode(any())).thenReturn(new HouseholdEntity());

        assertThatThrownBy(() -> householdService.regenerateInviteCode(1L))
                .isInstanceOf(DuplicateResourceException.class);
        verify(householdMapper, org.mockito.Mockito.times(5)).findByInviteCode(any());
        verify(householdMapper, org.mockito.Mockito.never()).updateInviteCode(anyLong(), any());
    }

    @Test
    void regenerateInviteCode_招待コードがDB制約で競合した場合は409() {
        householdService = service();
        HouseholdMemberEntity member = new HouseholdMemberEntity();
        member.setHouseholdId(10L);
        when(householdMemberMapper.findByUserId(1L)).thenReturn(member);
        when(householdMapper.findByInviteCode(any())).thenReturn(null);
        org.mockito.Mockito.doThrow(new DuplicateKeyException("duplicate invite_code"))
                .when(householdMapper).updateInviteCode(anyLong(), any());

        assertThatThrownBy(() -> householdService.regenerateInviteCode(1L))
                .isInstanceOf(DuplicateResourceException.class);
    }

    @Test
    void regenerateInviteCode_未所属の場合は404() {
        householdService = service();
        when(householdMemberMapper.findByUserId(1L)).thenReturn(null);

        assertThatThrownBy(() -> householdService.regenerateInviteCode(1L))
                .isInstanceOf(ResourceNotFoundException.class);
        verify(householdMapper, org.mockito.Mockito.never()).updateInviteCode(anyLong(), any());
    }
}

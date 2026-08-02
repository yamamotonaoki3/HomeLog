package com.homelog.kakeibo.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.entity.HouseholdMemberEntity;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.kakeibo.dto.request.CreateFixedCostRequest;
import com.homelog.kakeibo.dto.request.UpdateFixedCostRequest;
import com.homelog.kakeibo.dto.response.FixedCostResponse;
import com.homelog.kakeibo.entity.FixedCostEntity;
import com.homelog.kakeibo.mapper.FixedCostMapper;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class FixedCostServiceTest {

    @Mock
    private FixedCostMapper fixedCostMapper;
    @Mock
    private HouseholdMemberMapper householdMemberMapper;
    @Mock
    private AccountService accountService;
    @Mock
    private CardService cardService;

    private FixedCostService service() {
        return new FixedCostService(fixedCostMapper, householdMemberMapper, accountService, cardService);
    }

    private HouseholdMemberEntity memberOf(long householdId) {
        HouseholdMemberEntity member = new HouseholdMemberEntity();
        member.setHouseholdId(householdId);
        return member;
    }

    private FixedCostEntity fixedCostOf(long id, long householdId, Long ownerUserId, long createdByUserId) {
        FixedCostEntity fixedCost = new FixedCostEntity();
        fixedCost.setId(id);
        fixedCost.setHouseholdId(householdId);
        fixedCost.setOwnerUserId(ownerUserId);
        fixedCost.setCreatedByUserId(createdByUserId);
        fixedCost.setName("家賃");
        fixedCost.setAmount(new BigDecimal("80000"));
        fixedCost.setPaymentDay(27);
        fixedCost.setIncludeInHouseholdTotal(false);
        return fixedCost;
    }

    @Test
    void listFixedCosts_世帯共有と個人所有の両方を返しeditableを算出する() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        FixedCostEntity shared = fixedCostOf(50L, 10L, null, 1L);
        FixedCostEntity othersPersonal = fixedCostOf(51L, 10L, 2L, 2L);
        when(fixedCostMapper.findVisibleByHouseholdIdAndUserId(10L, 1L)).thenReturn(List.of(shared, othersPersonal));

        List<FixedCostResponse> response = service().listFixedCosts(1L);

        assertThat(response).hasSize(2);
        assertThat(response.get(0).personal()).isFalse();
        assertThat(response.get(0).editable()).isTrue();
        assertThat(response.get(1).personal()).isTrue();
        assertThat(response.get(1).editable()).isFalse();
    }

    @Test
    void listFixedCosts_他ユーザーが世帯共有固定費を閲覧すると口座とカードのIDを返さない() {
        when(householdMemberMapper.findByUserId(2L)).thenReturn(memberOf(10L));
        FixedCostEntity shared = fixedCostOf(50L, 10L, null, 1L);
        shared.setAccountId(5L);
        when(fixedCostMapper.findVisibleByHouseholdIdAndUserId(10L, 2L)).thenReturn(List.of(shared));

        List<FixedCostResponse> response = service().listFixedCosts(2L);

        assertThat(response).singleElement().satisfies(fixedCost -> {
            assertThat(fixedCost.editable()).isFalse();
            assertThat(fixedCost.accountId()).isNull();
            assertThat(fixedCost.cardId()).isNull();
        });
    }

    @Test
    void createFixedCost_personalがtrueならowner_user_idに自分を設定する() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));

        FixedCostResponse response = service()
                .createFixedCost(1L, new CreateFixedCostRequest("Aの個人サブスク", 1000L, 10, true, null, null, null));

        assertThat(response.personal()).isTrue();
        assertThat(response.editable()).isTrue();
        ArgumentCaptor<FixedCostEntity> captor = ArgumentCaptor.forClass(FixedCostEntity.class);
        verify(fixedCostMapper).insert(captor.capture());
        assertThat(captor.getValue().getOwnerUserId()).isEqualTo(1L);
        assertThat(captor.getValue().getCreatedByUserId()).isEqualTo(1L);
        assertThat(captor.getValue().getHouseholdId()).isEqualTo(10L);
    }

    @Test
    void createFixedCost_personalがfalseならowner_user_idはnullになる() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));

        FixedCostResponse response = service()
                .createFixedCost(1L, new CreateFixedCostRequest("家賃", 80000L, 27, false, true, null, null));

        assertThat(response.personal()).isFalse();
        ArgumentCaptor<FixedCostEntity> captor = ArgumentCaptor.forClass(FixedCostEntity.class);
        verify(fixedCostMapper).insert(captor.capture());
        assertThat(captor.getValue().getOwnerUserId()).isNull();
        assertThat(captor.getValue().getCreatedByUserId()).isEqualTo(1L);
        assertThat(captor.getValue().isIncludeInHouseholdTotal()).isTrue();
    }

    @Test
    void createFixedCost_口座を指定すると所有権検証したうえでaccountIdを保存する() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));

        FixedCostResponse response = service()
                .createFixedCost(1L, new CreateFixedCostRequest("家賃", 80000L, 27, false, null, 5L, null));

        assertThat(response.accountId()).isEqualTo(5L);
        assertThat(response.cardId()).isNull();
        verify(accountService).validateOwnedAccountForExpense(1L, 10L, 5L);
        verify(accountService).lockAccountForUpdate(5L);
        ArgumentCaptor<FixedCostEntity> captor = ArgumentCaptor.forClass(FixedCostEntity.class);
        verify(fixedCostMapper).insert(captor.capture());
        assertThat(captor.getValue().getAccountId()).isEqualTo(5L);
        assertThat(captor.getValue().getCardId()).isNull();
    }

    @Test
    void createFixedCost_カードを指定すると所有権検証したうえでcardIdを保存する() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));

        FixedCostResponse response = service()
                .createFixedCost(1L, new CreateFixedCostRequest("サブスク", 1000L, 1, false, null, null, 50L));

        assertThat(response.cardId()).isEqualTo(50L);
        assertThat(response.accountId()).isNull();
        verify(accountService).findOwnedCardForExpense(1L, 10L, 50L);
        verify(cardService).lockCardForUpdate(50L);
        ArgumentCaptor<FixedCostEntity> captor = ArgumentCaptor.forClass(FixedCostEntity.class);
        verify(fixedCostMapper).insert(captor.capture());
        assertThat(captor.getValue().getCardId()).isEqualTo(50L);
        assertThat(captor.getValue().getAccountId()).isNull();
    }

    @Test
    void createFixedCost_口座とカードを同時に指定すると400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));

        assertThatThrownBy(() -> service()
                .createFixedCost(1L, new CreateFixedCostRequest("家賃", 80000L, 27, false, null, 5L, 50L)))
                .isInstanceOf(BadRequestException.class);
        verify(fixedCostMapper, never()).insert(any());
    }

    @Test
    void createFixedCost_他人の口座を指定すると400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        doThrow(new BadRequestException("指定された口座が見つかりません"))
                .when(accountService).validateOwnedAccountForExpense(1L, 10L, 5L);

        assertThatThrownBy(() -> service()
                .createFixedCost(1L, new CreateFixedCostRequest("家賃", 80000L, 27, false, null, 5L, null)))
                .isInstanceOf(BadRequestException.class);
        verify(fixedCostMapper, never()).insert(any());
    }

    @Test
    void updateFixedCost_登録者本人なら更新できる() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(fixedCostMapper.findById(50L)).thenReturn(fixedCostOf(50L, 10L, null, 1L));

        FixedCostResponse response = service()
                .updateFixedCost(1L, 50L, new UpdateFixedCostRequest("新名称", 90000L, 28, true, null, null, null));

        assertThat(response.name()).isEqualTo("新名称");
        assertThat(response.personal()).isTrue();
        verify(fixedCostMapper).update(50L, "新名称", new BigDecimal("90000"), 28, 1L, false, null, null);
    }

    @Test
    void updateFixedCost_引き落とし元の口座を更新できる() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(fixedCostMapper.findById(50L)).thenReturn(fixedCostOf(50L, 10L, null, 1L));

        FixedCostResponse response = service()
                .updateFixedCost(1L, 50L, new UpdateFixedCostRequest("家賃", 80000L, 27, false, null, 5L, null));

        assertThat(response.accountId()).isEqualTo(5L);
        verify(accountService).validateOwnedAccountForExpense(1L, 10L, 5L);
        verify(accountService).lockAccountForUpdate(5L);
        verify(fixedCostMapper).update(50L, "家賃", new BigDecimal("80000"), 27, null, false, 5L, null);
    }

    @Test
    void updateFixedCost_世帯共有でも登録者以外は404() {
        when(householdMemberMapper.findByUserId(2L)).thenReturn(memberOf(10L));
        when(fixedCostMapper.findById(50L)).thenReturn(fixedCostOf(50L, 10L, null, 1L));

        assertThatThrownBy(() -> service()
                .updateFixedCost(2L, 50L, new UpdateFixedCostRequest("新名称", 90000L, 28, false, null, null, null)))
                .isInstanceOf(ResourceNotFoundException.class);
        verify(fixedCostMapper, never()).update(anyLong(), any(), any(), anyInt(), any(), anyBoolean(), any(), any());
    }

    @Test
    void updateFixedCost_異なる世帯に移動した場合は404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(20L));
        when(fixedCostMapper.findById(50L)).thenReturn(fixedCostOf(50L, 10L, null, 1L));

        assertThatThrownBy(() -> service()
                .updateFixedCost(1L, 50L, new UpdateFixedCostRequest("新名称", 90000L, 28, false, null, null, null)))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void updateFixedCost_存在しないIDは404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(fixedCostMapper.findById(50L)).thenReturn(null);

        assertThatThrownBy(() -> service()
                .updateFixedCost(1L, 50L, new UpdateFixedCostRequest("新名称", 90000L, 28, false, null, null, null)))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void deleteFixedCost_登録者本人なら削除できる() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(fixedCostMapper.findById(50L)).thenReturn(fixedCostOf(50L, 10L, null, 1L));

        service().deleteFixedCost(1L, 50L);

        verify(fixedCostMapper).delete(50L);
    }

    @Test
    void deleteFixedCost_登録者以外は404() {
        when(householdMemberMapper.findByUserId(2L)).thenReturn(memberOf(10L));
        when(fixedCostMapper.findById(50L)).thenReturn(fixedCostOf(50L, 10L, null, 1L));

        assertThatThrownBy(() -> service().deleteFixedCost(2L, 50L)).isInstanceOf(ResourceNotFoundException.class);
        verify(fixedCostMapper, never()).delete(anyLong());
    }
}

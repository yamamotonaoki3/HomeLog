package com.homelog.kakeibo.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import static org.mockito.Mockito.inOrder;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.entity.HouseholdMemberEntity;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.kakeibo.dto.request.ChargeCardRequest;
import com.homelog.kakeibo.dto.request.CreateCardRequest;
import com.homelog.kakeibo.dto.request.UpdateCardRequest;
import com.homelog.kakeibo.dto.response.CardResponse;
import com.homelog.kakeibo.dto.response.ChargeResponse;
import com.homelog.kakeibo.entity.AccountEntity;
import com.homelog.kakeibo.entity.CardEntity;
import com.homelog.kakeibo.mapper.AccountMapper;
import com.homelog.kakeibo.mapper.CardChargeMapper;
import com.homelog.kakeibo.mapper.CardMapper;
import com.homelog.kakeibo.mapper.ExpenseMapper;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class CardServiceTest {

    @Mock
    private CardMapper cardMapper;
    @Mock
    private AccountMapper accountMapper;
    @Mock
    private CardChargeMapper cardChargeMapper;
    @Mock
    private ExpenseMapper expenseMapper;
    @Mock
    private HouseholdMemberMapper householdMemberMapper;

    private CardService service() {
        return new CardService(cardMapper, accountMapper, cardChargeMapper, expenseMapper, householdMemberMapper);
    }

    private HouseholdMemberEntity memberOf(long householdId) {
        HouseholdMemberEntity member = new HouseholdMemberEntity();
        member.setHouseholdId(householdId);
        return member;
    }

    private AccountEntity accountOf(long id, long householdId, long ownerUserId) {
        AccountEntity account = new AccountEntity();
        account.setId(id);
        account.setHouseholdId(householdId);
        account.setOwnerUserId(ownerUserId);
        account.setBalance(new BigDecimal("10000"));
        return account;
    }

    private CardEntity cardOf(long id, long accountId) {
        CardEntity card = new CardEntity();
        card.setId(id);
        card.setAccountId(accountId);
        card.setName("旧カード名");
        card.setCardType("credit");
        card.setBalance(BigDecimal.ZERO);
        return card;
    }

    private CardEntity chargeCardOf(long id, long accountId, String balance) {
        CardEntity card = new CardEntity();
        card.setId(id);
        card.setAccountId(accountId);
        card.setName("チャージカード");
        card.setCardType("charge");
        card.setBalance(new BigDecimal(balance));
        return card;
    }

    @Test
    void createCard_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 1L));

        CardResponse response = service().createCard(1L, new CreateCardRequest(5L, "〇〇カード", "credit"));

        assertThat(response.name()).isEqualTo("〇〇カード");
        verify(cardMapper).insert(any(CardEntity.class));
    }

    @Test
    void createCard_cardType省略時はcreditで登録する() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 1L));

        CardResponse response = service().createCard(1L, new CreateCardRequest(5L, "〇〇カード", null));

        assertThat(response.cardType()).isEqualTo("credit");
        verify(cardMapper).insert(any(CardEntity.class));
    }

    @Test
    void createCard_他人の口座指定は400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 999L));

        assertThatThrownBy(() -> service().createCard(1L, new CreateCardRequest(5L, "〇〇カード", "credit")))
                .isInstanceOf(BadRequestException.class);
        verify(cardMapper, never()).insert(any());
    }

    @Test
    void createCard_異なる世帯の口座指定は400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 999L, 1L));

        assertThatThrownBy(() -> service().createCard(1L, new CreateCardRequest(5L, "〇〇カード", "credit")))
                .isInstanceOf(BadRequestException.class);
        verify(cardMapper, never()).insert(any());
    }

    @Test
    void createCard_存在しない口座指定は400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(accountMapper.findById(5L)).thenReturn(null);

        assertThatThrownBy(() -> service().createCard(1L, new CreateCardRequest(5L, "〇〇カード", "credit")))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void updateCard_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(cardMapper.findById(50L)).thenReturn(cardOf(50L, 5L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 1L));

        CardResponse response = service().updateCard(1L, 50L, new UpdateCardRequest("新カード名"));

        assertThat(response.name()).isEqualTo("新カード名");
        verify(cardMapper).update(50L, "新カード名");
    }

    @Test
    void updateCard_他人のカードは404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(cardMapper.findById(50L)).thenReturn(cardOf(50L, 5L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 999L));

        assertThatThrownBy(() -> service().updateCard(1L, 50L, new UpdateCardRequest("新カード名")))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void updateCard_異なる世帯のカードは404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(cardMapper.findById(50L)).thenReturn(cardOf(50L, 5L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 999L, 1L));

        assertThatThrownBy(() -> service().updateCard(1L, 50L, new UpdateCardRequest("新カード名")))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void deleteCard_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(cardMapper.findById(50L)).thenReturn(cardOf(50L, 5L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 1L));
        when(expenseMapper.countByCardId(50L)).thenReturn(0);
        when(cardChargeMapper.countByCardId(50L)).thenReturn(0);

        service().deleteCard(1L, 50L);

        InOrder inOrder = inOrder(cardMapper, expenseMapper, cardChargeMapper);
        inOrder.verify(cardMapper).lockById(50L);
        inOrder.verify(expenseMapper).countByCardId(50L);
        inOrder.verify(cardChargeMapper).countByCardId(50L);
        inOrder.verify(cardMapper).delete(50L);
    }

    @Test
    void deleteCard_支出で使用中は削除不可() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(cardMapper.findById(50L)).thenReturn(cardOf(50L, 5L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 1L));
        when(expenseMapper.countByCardId(50L)).thenReturn(1);

        assertThatThrownBy(() -> service().deleteCard(1L, 50L)).isInstanceOf(BadRequestException.class);
        verify(cardMapper, never()).delete(anyLong());
    }

    @Test
    void deleteCard_チャージ履歴で使用中は削除不可() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(cardMapper.findById(50L)).thenReturn(cardOf(50L, 5L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 1L));
        when(expenseMapper.countByCardId(50L)).thenReturn(0);
        when(cardChargeMapper.countByCardId(50L)).thenReturn(1);

        assertThatThrownBy(() -> service().deleteCard(1L, 50L)).isInstanceOf(BadRequestException.class);
        verify(cardMapper, never()).delete(anyLong());
    }

    @Test
    void deleteCard_他人のカードは404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(cardMapper.findById(50L)).thenReturn(cardOf(50L, 5L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 999L));

        assertThatThrownBy(() -> service().deleteCard(1L, 50L)).isInstanceOf(ResourceNotFoundException.class);
        verify(cardMapper, never()).delete(anyLong());
    }

    @Test
    void deleteCard_存在しないカードは404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(cardMapper.findById(50L)).thenReturn(null);

        assertThatThrownBy(() -> service().deleteCard(1L, 50L)).isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void chargeCard_正常系_口座からカードへ残高を移動する() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(cardMapper.findById(50L)).thenReturn(chargeCardOf(50L, 5L, "2000"));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 1L));
        when(accountMapper.lockById(5L)).thenReturn(accountOf(5L, 10L, 1L));
        when(cardMapper.lockById(50L)).thenReturn(chargeCardOf(50L, 5L, "2000"));

        ChargeResponse response = service().chargeCard(1L, 50L, new ChargeCardRequest(5L, 3000L));

        assertThat(response.cardBalanceAfter()).isEqualByComparingTo("5000");
        assertThat(response.accountBalanceAfter()).isEqualByComparingTo("7000");
        InOrder inOrder = inOrder(accountMapper, cardMapper, cardChargeMapper);
        inOrder.verify(accountMapper).lockById(5L);
        inOrder.verify(cardMapper).lockById(50L);
        inOrder.verify(cardChargeMapper).insert(any());
        inOrder.verify(accountMapper).updateBalance(5L, new BigDecimal("7000"));
        inOrder.verify(cardMapper).updateBalance(50L, new BigDecimal("5000"));
    }

    @Test
    void chargeCard_credit型カードへのチャージは400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(cardMapper.findById(50L)).thenReturn(cardOf(50L, 5L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 1L));

        assertThatThrownBy(() -> service().chargeCard(1L, 50L, new ChargeCardRequest(5L, 3000L)))
                .isInstanceOf(BadRequestException.class);
        verify(accountMapper, never()).lockById(anyLong());
    }

    @Test
    void chargeCard_他人のカードは404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(cardMapper.findById(50L)).thenReturn(chargeCardOf(50L, 5L, "0"));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 999L));

        assertThatThrownBy(() -> service().chargeCard(1L, 50L, new ChargeCardRequest(5L, 3000L)))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void chargeCard_他人の口座指定は400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(cardMapper.findById(50L)).thenReturn(chargeCardOf(50L, 5L, "0"));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 1L));
        when(accountMapper.findById(7L)).thenReturn(accountOf(7L, 10L, 999L));

        assertThatThrownBy(() -> service().chargeCard(1L, 50L, new ChargeCardRequest(7L, 3000L)))
                .isInstanceOf(BadRequestException.class);
        verify(accountMapper, never()).lockById(anyLong());
    }
}

package com.homelog.kakeibo.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.entity.HouseholdMemberEntity;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.kakeibo.dto.request.CreateAccountRequest;
import com.homelog.kakeibo.dto.request.UpdateAccountRequest;
import com.homelog.kakeibo.dto.response.AccountResponse;
import com.homelog.kakeibo.entity.AccountEntity;
import com.homelog.kakeibo.entity.CardEntity;
import com.homelog.kakeibo.mapper.AccountMapper;
import com.homelog.kakeibo.mapper.CardMapper;
import com.homelog.kakeibo.mapper.ExpenseMapper;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class AccountServiceTest {

    @Mock
    private AccountMapper accountMapper;
    @Mock
    private CardMapper cardMapper;
    @Mock
    private ExpenseMapper expenseMapper;
    @Mock
    private HouseholdMemberMapper householdMemberMapper;

    private AccountService service() {
        return new AccountService(accountMapper, cardMapper, expenseMapper, householdMemberMapper);
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
        account.setName("〇〇銀行");
        account.setType("bank");
        account.setBalance(new BigDecimal("10000"));
        return account;
    }

    @Test
    void listAccounts_自分の口座一覧をカード付きで返す() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        AccountEntity account = accountOf(5L, 10L, 1L);
        when(accountMapper.findByHouseholdIdAndOwnerUserId(10L, 1L)).thenReturn(List.of(account));
        CardEntity card = new CardEntity();
        card.setId(50L);
        card.setAccountId(5L);
        card.setName("〇〇カード");
        when(cardMapper.findByAccountId(5L)).thenReturn(List.of(card));

        List<AccountResponse> response = service().listAccounts(1L);

        assertThat(response).hasSize(1);
        assertThat(response.get(0).cards()).hasSize(1);
        assertThat(response.get(0).cards().get(0).name()).isEqualTo("〇〇カード");
    }

    @Test
    void listAccounts_未所属の場合は404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(null);

        assertThatThrownBy(() -> service().listAccounts(1L)).isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void createAccount_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));

        AccountResponse response = service().createAccount(1L, new CreateAccountRequest("PayPay", "e_money", 3000L));

        assertThat(response.name()).isEqualTo("PayPay");
        assertThat(response.balance()).isEqualByComparingTo(new BigDecimal("3000"));
        org.mockito.ArgumentCaptor<AccountEntity> captor = org.mockito.ArgumentCaptor.forClass(AccountEntity.class);
        verify(accountMapper).insert(captor.capture());
        assertThat(captor.getValue().getOwnerUserId()).isEqualTo(1L);
        assertThat(captor.getValue().getHouseholdId()).isEqualTo(10L);
    }

    @Test
    void updateAccount_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 1L));

        AccountResponse response = service().updateAccount(1L, 5L, new UpdateAccountRequest("新名義", "bank"));

        assertThat(response.name()).isEqualTo("新名義");
        verify(accountMapper).update(5L, "新名義", "bank");
    }

    @Test
    void updateAccount_他人の口座は404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 999L));

        assertThatThrownBy(() -> service().updateAccount(1L, 5L, new UpdateAccountRequest("新名義", "bank")))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void updateAccount_退出前の世帯に残った口座は404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(20L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 1L));

        assertThatThrownBy(() -> service().updateAccount(1L, 5L, new UpdateAccountRequest("新名義", "bank")))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void deleteAccount_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 1L));
        when(expenseMapper.countByAccountId(5L)).thenReturn(0);

        service().deleteAccount(1L, 5L);

        verify(accountMapper).delete(5L);
    }

    @Test
    void deleteAccount_使用中は削除不可() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 1L));
        when(expenseMapper.countByAccountId(5L)).thenReturn(1);

        assertThatThrownBy(() -> service().deleteAccount(1L, 5L)).isInstanceOf(BadRequestException.class);
        verify(accountMapper, never()).delete(anyLong());
    }

    @Test
    void deleteAccount_他人の口座は404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 999L));

        assertThatThrownBy(() -> service().deleteAccount(1L, 5L)).isInstanceOf(ResourceNotFoundException.class);
        verify(accountMapper, never()).delete(anyLong());
    }

    @Test
    void deleteAccount_退出前の世帯に残った口座は404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(20L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 1L));

        assertThatThrownBy(() -> service().deleteAccount(1L, 5L)).isInstanceOf(ResourceNotFoundException.class);
        verify(accountMapper, never()).delete(anyLong());
    }

    @Test
    void validateOwnedAccountForExpense_本人所有かつ現在の世帯なら例外なし() {
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 1L));

        service().validateOwnedAccountForExpense(1L, 10L, 5L);
    }

    @Test
    void validateOwnedAccountForExpense_他人の口座指定は400() {
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 999L));

        assertThatThrownBy(() -> service().validateOwnedAccountForExpense(1L, 10L, 5L))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void validateOwnedAccountForExpense_存在しない口座指定は400() {
        when(accountMapper.findById(5L)).thenReturn(null);

        assertThatThrownBy(() -> service().validateOwnedAccountForExpense(1L, 10L, 5L))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void decrementBalance_行ロック後に残高を減算する() {
        AccountEntity account = accountOf(5L, 10L, 1L);
        account.setBalance(new BigDecimal("10000"));
        when(accountMapper.lockById(5L)).thenReturn(account);

        service().decrementBalance(5L, new BigDecimal("3000"));

        InOrder inOrder = inOrder(accountMapper);
        inOrder.verify(accountMapper).lockById(5L);
        inOrder.verify(accountMapper).updateBalance(5L, new BigDecimal("7000"));
    }

    private CardEntity cardOf(long id, long accountId) {
        CardEntity card = new CardEntity();
        card.setId(id);
        card.setAccountId(accountId);
        return card;
    }

    @Test
    void resolveAccountIdFromCard_本人所有かつ現在の世帯なら親口座IDを返す() {
        when(cardMapper.findById(70L)).thenReturn(cardOf(70L, 5L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 1L));

        Long accountId = service().resolveAccountIdFromCard(1L, 10L, 70L);

        assertThat(accountId).isEqualTo(5L);
    }

    @Test
    void resolveAccountIdFromCard_他人のカード指定は400() {
        when(cardMapper.findById(70L)).thenReturn(cardOf(70L, 5L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 10L, 999L));

        assertThatThrownBy(() -> service().resolveAccountIdFromCard(1L, 10L, 70L))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void resolveAccountIdFromCard_存在しないカード指定は400() {
        when(cardMapper.findById(70L)).thenReturn(null);

        assertThatThrownBy(() -> service().resolveAccountIdFromCard(1L, 10L, 70L))
                .isInstanceOf(BadRequestException.class);
    }
}

package com.homelog.kakeibo.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.entity.HouseholdMemberEntity;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.kakeibo.dto.request.CreateExpenseRequest;
import com.homelog.kakeibo.dto.response.ExpenseResponse;
import com.homelog.kakeibo.entity.AccountEntity;
import com.homelog.kakeibo.entity.CardEntity;
import com.homelog.kakeibo.entity.ExpenseEntity;
import com.homelog.kakeibo.entity.KakeiboCategoryEntity;
import com.homelog.kakeibo.mapper.ExpenseMapper;
import com.homelog.kakeibo.mapper.KakeiboCategoryMapper;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ExpenseServiceTest {

    @Mock
    private ExpenseMapper expenseMapper;
    @Mock
    private KakeiboCategoryMapper kakeiboCategoryMapper;
    @Mock
    private HouseholdMemberMapper householdMemberMapper;
    @Mock
    private AccountService accountService;
    @Mock
    private CardService cardService;

    private ExpenseService service() {
        return new ExpenseService(expenseMapper, kakeiboCategoryMapper, householdMemberMapper, accountService,
                cardService);
    }

    private CardEntity creditCardOf(long id, long accountId) {
        CardEntity card = new CardEntity();
        card.setId(id);
        card.setAccountId(accountId);
        card.setCardType("credit");
        return card;
    }

    private CardEntity chargeCardOf(long id, String balance) {
        CardEntity card = new CardEntity();
        card.setId(id);
        card.setCardType("charge");
        card.setBalance(new BigDecimal(balance));
        return card;
    }

    private HouseholdMemberEntity memberOf(long householdId) {
        HouseholdMemberEntity member = new HouseholdMemberEntity();
        member.setHouseholdId(householdId);
        return member;
    }

    private KakeiboCategoryEntity categoryOf(long id, long householdId) {
        KakeiboCategoryEntity category = new KakeiboCategoryEntity();
        category.setId(id);
        category.setHouseholdId(householdId);
        return category;
    }

    @Test
    void listExpenses_自分の支出一覧を返す() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        ExpenseEntity entity = new ExpenseEntity();
        entity.setId(100L);
        entity.setCategoryId(5L);
        entity.setAmount(new BigDecimal("1000"));
        entity.setPurpose("ランチ");
        entity.setExpenseDate(LocalDate.of(2026, 1, 1));
        entity.setIncludeInHouseholdTotal(false);
        when(expenseMapper.findByPayerUserId(10L, 1L, null)).thenReturn(List.of(entity));

        List<ExpenseResponse> response = service().listExpenses(1L, null);

        assertThat(response).hasSize(1);
        assertThat(response.get(0).purpose()).isEqualTo("ランチ");
    }

    @Test
    void listExpenses_現在所属する世帯IDで支出を絞り込む() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(20L));
        ExpenseEntity currentHouseholdExpense = new ExpenseEntity();
        currentHouseholdExpense.setId(200L);
        currentHouseholdExpense.setPurpose("現世帯の支出");
        currentHouseholdExpense.setAmount(new BigDecimal("2000"));
        currentHouseholdExpense.setExpenseDate(LocalDate.of(2026, 2, 1));
        when(expenseMapper.findByPayerUserId(20L, 1L, null))
                .thenReturn(List.of(currentHouseholdExpense));

        List<ExpenseResponse> response = service().listExpenses(1L, null);

        assertThat(response).extracting(ExpenseResponse::purpose)
                .containsExactly("現世帯の支出");
        verify(expenseMapper).findByPayerUserId(20L, 1L, null);
    }

    @Test
    void listExpenses_未所属の場合は404() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(null);

        assertThatThrownBy(() -> service().listExpenses(1L, null)).isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void createExpense_正常系_payerUserIdは自分自身に固定される() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(categoryOf(5L, 10L));

        CreateExpenseRequest request = new CreateExpenseRequest(
                LocalDate.of(2026, 1, 1), 1000L, "ランチ", 5L, "メモ", null, null, null);
        ExpenseResponse response = service().createExpense(1L, request);

        assertThat(response.purpose()).isEqualTo("ランチ");
        assertThat(response.includeInHouseholdTotal()).isFalse();
        org.mockito.ArgumentCaptor<ExpenseEntity> captor = org.mockito.ArgumentCaptor.forClass(ExpenseEntity.class);
        verify(expenseMapper).insert(captor.capture());
        assertThat(captor.getValue().getPayerUserId()).isEqualTo(1L);
        assertThat(captor.getValue().getHouseholdId()).isEqualTo(10L);
    }

    @Test
    void createExpense_他世帯のカテゴリー指定は400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(categoryOf(5L, 999L));

        CreateExpenseRequest request = new CreateExpenseRequest(
                LocalDate.of(2026, 1, 1), 1000L, "ランチ", 5L, null, null, null, null);

        assertThatThrownBy(() -> service().createExpense(1L, request)).isInstanceOf(BadRequestException.class);
        verify(expenseMapper, never()).insert(any());
    }

    @Test
    void createExpense_存在しないカテゴリー指定は400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(null);

        CreateExpenseRequest request = new CreateExpenseRequest(
                LocalDate.of(2026, 1, 1), 1000L, "ランチ", 5L, null, null, null, null);

        assertThatThrownBy(() -> service().createExpense(1L, request)).isInstanceOf(BadRequestException.class);
    }

    @Test
    void createExpense_世帯合計対象フラグ未指定はfalseになる() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(categoryOf(5L, 10L));

        CreateExpenseRequest request = new CreateExpenseRequest(
                LocalDate.of(2026, 1, 1), 1000L, "ランチ", 5L, null, null, null, null);
        ExpenseResponse response = service().createExpense(1L, request);

        assertThat(response.includeInHouseholdTotal()).isFalse();
    }

    @Test
    void createExpense_世帯合計対象フラグtrue指定時はtrueになる() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(categoryOf(5L, 10L));

        CreateExpenseRequest request = new CreateExpenseRequest(
                LocalDate.of(2026, 1, 1), 1000L, "ランチ", 5L, null, true, null, null);
        ExpenseResponse response = service().createExpense(1L, request);

        assertThat(response.includeInHouseholdTotal()).isTrue();
    }

    private AccountEntity accountWithBalance(long id, String balance) {
        AccountEntity account = new AccountEntity();
        account.setId(id);
        account.setBalance(new BigDecimal(balance));
        return account;
    }

    @Test
    void createExpense_口座指定ありの場合は所有チェック後に残高を減算する() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(categoryOf(5L, 10L));
        when(accountService.lockAccountForUpdate(7L)).thenReturn(accountWithBalance(7L, "10000"));

        CreateExpenseRequest request = new CreateExpenseRequest(
                LocalDate.of(2026, 1, 1), 1000L, "ランチ", 5L, null, null, 7L, null);
        ExpenseResponse response = service().createExpense(1L, request);

        assertThat(response.accountId()).isEqualTo(7L);
        verify(accountService).validateOwnedAccountForExpense(1L, 10L, 7L);
        verify(accountService).lockAccountForUpdate(7L);
        verify(accountService).updateBalance(7L, new BigDecimal("9000"));
    }

    @Test
    void createExpense_他人の口座指定は400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(categoryOf(5L, 10L));
        Mockito.doThrow(new BadRequestException("指定された口座が見つかりません"))
                .when(accountService).validateOwnedAccountForExpense(1L, 10L, 7L);

        CreateExpenseRequest request = new CreateExpenseRequest(
                LocalDate.of(2026, 1, 1), 1000L, "ランチ", 5L, null, null, 7L, null);

        assertThatThrownBy(() -> service().createExpense(1L, request)).isInstanceOf(BadRequestException.class);
        verify(expenseMapper, never()).insert(any());
        verify(accountService, never()).lockAccountForUpdate(any());
        verify(accountService, never()).updateBalance(any(), any());
    }

    @Test
    void createExpense_口座未指定の場合は残高減算を呼ばない() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(categoryOf(5L, 10L));

        CreateExpenseRequest request = new CreateExpenseRequest(
                LocalDate.of(2026, 1, 1), 1000L, "ランチ", 5L, null, null, null, null);
        service().createExpense(1L, request);

        verify(accountService, never()).validateOwnedAccountForExpense(any(), any(), any());
        verify(accountService, never()).lockAccountForUpdate(any());
        verify(accountService, never()).updateBalance(any(), any());
    }

    @Test
    void createExpense_credit型カード指定ありの場合は親口座を解決して残高を減算する() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(categoryOf(5L, 10L));
        when(accountService.findOwnedCardForExpense(1L, 10L, 70L)).thenReturn(creditCardOf(70L, 7L));
        when(accountService.lockAccountForUpdate(7L)).thenReturn(accountWithBalance(7L, "10000"));

        CreateExpenseRequest request = new CreateExpenseRequest(
                LocalDate.of(2026, 1, 1), 1000L, "ランチ", 5L, null, null, null, 70L);
        ExpenseResponse response = service().createExpense(1L, request);

        assertThat(response.accountId()).isEqualTo(7L);
        assertThat(response.cardId()).isNull();
        verify(accountService).findOwnedCardForExpense(1L, 10L, 70L);
        verify(accountService).lockAccountForUpdate(7L);
        verify(accountService).updateBalance(7L, new BigDecimal("9000"));
        verify(accountService, never()).validateOwnedAccountForExpense(any(), any(), any());
        verify(cardService, never()).lockCardForUpdate(any());
    }

    @Test
    void createExpense_charge型カード指定の場合はカード自身の残高を減算する() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(categoryOf(5L, 10L));
        when(accountService.findOwnedCardForExpense(1L, 10L, 70L)).thenReturn(chargeCardOf(70L, "0"));
        when(cardService.lockCardForUpdate(70L)).thenReturn(chargeCardOf(70L, "5000"));

        CreateExpenseRequest request = new CreateExpenseRequest(
                LocalDate.of(2026, 1, 1), 1000L, "電車代", 5L, null, null, null, 70L);
        ExpenseResponse response = service().createExpense(1L, request);

        assertThat(response.cardId()).isEqualTo(70L);
        assertThat(response.accountId()).isNull();
        verify(cardService).lockCardForUpdate(70L);
        verify(cardService).updateBalance(70L, new BigDecimal("4000"));
        verify(accountService, never()).lockAccountForUpdate(any());
        verify(accountService, never()).updateBalance(any(), any());
    }

    @Test
    void createExpense_他人のカード指定は400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(categoryOf(5L, 10L));
        Mockito.doThrow(new BadRequestException("指定されたカードが見つかりません"))
                .when(accountService).findOwnedCardForExpense(1L, 10L, 70L);

        CreateExpenseRequest request = new CreateExpenseRequest(
                LocalDate.of(2026, 1, 1), 1000L, "ランチ", 5L, null, null, null, 70L);

        assertThatThrownBy(() -> service().createExpense(1L, request)).isInstanceOf(BadRequestException.class);
        verify(expenseMapper, never()).insert(any());
        verify(accountService, never()).lockAccountForUpdate(any());
        verify(accountService, never()).updateBalance(any(), any());
        verify(cardService, never()).lockCardForUpdate(any());
    }

    @Test
    void createExpense_口座とカードを同時に指定すると400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(categoryOf(5L, 10L));

        CreateExpenseRequest request = new CreateExpenseRequest(
                LocalDate.of(2026, 1, 1), 1000L, "ランチ", 5L, null, null, 7L, 70L);

        assertThatThrownBy(() -> service().createExpense(1L, request)).isInstanceOf(BadRequestException.class);
        verify(expenseMapper, never()).insert(any());
        verify(accountService, never()).lockAccountForUpdate(any());
        verify(accountService, never()).updateBalance(any(), any());
    }
}

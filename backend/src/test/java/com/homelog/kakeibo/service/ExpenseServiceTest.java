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
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ExpenseServiceTest {

    @Mock
    private ExpenseMapper expenseMapper;
    @Mock
    private KakeiboCategoryMapper kakeiboCategoryMapper;
    @Mock
    private HouseholdMemberMapper householdMemberMapper;

    private ExpenseService service() {
        return new ExpenseService(expenseMapper, kakeiboCategoryMapper, householdMemberMapper);
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
                LocalDate.of(2026, 1, 1), 1000L, "ランチ", 5L, "メモ", null);
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
                LocalDate.of(2026, 1, 1), 1000L, "ランチ", 5L, null, null);

        assertThatThrownBy(() -> service().createExpense(1L, request)).isInstanceOf(BadRequestException.class);
        verify(expenseMapper, never()).insert(any());
    }

    @Test
    void createExpense_存在しないカテゴリー指定は400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(null);

        CreateExpenseRequest request = new CreateExpenseRequest(
                LocalDate.of(2026, 1, 1), 1000L, "ランチ", 5L, null, null);

        assertThatThrownBy(() -> service().createExpense(1L, request)).isInstanceOf(BadRequestException.class);
    }

    @Test
    void createExpense_世帯合計対象フラグ未指定はfalseになる() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(categoryOf(5L, 10L));

        CreateExpenseRequest request = new CreateExpenseRequest(
                LocalDate.of(2026, 1, 1), 1000L, "ランチ", 5L, null, null);
        ExpenseResponse response = service().createExpense(1L, request);

        assertThat(response.includeInHouseholdTotal()).isFalse();
    }

    @Test
    void createExpense_世帯合計対象フラグtrue指定時はtrueになる() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(kakeiboCategoryMapper.findById(5L)).thenReturn(categoryOf(5L, 10L));

        CreateExpenseRequest request = new CreateExpenseRequest(
                LocalDate.of(2026, 1, 1), 1000L, "ランチ", 5L, null, true);
        ExpenseResponse response = service().createExpense(1L, request);

        assertThat(response.includeInHouseholdTotal()).isTrue();
    }
}

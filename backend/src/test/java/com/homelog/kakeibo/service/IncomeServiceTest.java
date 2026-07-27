package com.homelog.kakeibo.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.homelog.common.exception.BadRequestException;
import com.homelog.household.entity.HouseholdMemberEntity;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.kakeibo.dto.request.CreateIncomeRequest;
import com.homelog.kakeibo.dto.response.IncomeResponse;
import com.homelog.kakeibo.entity.IncomeCategoryEntity;
import com.homelog.kakeibo.entity.IncomeEntity;
import com.homelog.kakeibo.mapper.IncomeCategoryMapper;
import com.homelog.kakeibo.mapper.IncomeMapper;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class IncomeServiceTest {

    @Mock
    private IncomeMapper incomeMapper;
    @Mock
    private IncomeCategoryMapper incomeCategoryMapper;
    @Mock
    private HouseholdMemberMapper householdMemberMapper;

    private IncomeService service() {
        return new IncomeService(incomeMapper, incomeCategoryMapper, householdMemberMapper);
    }

    private HouseholdMemberEntity memberOf(long householdId) {
        HouseholdMemberEntity member = new HouseholdMemberEntity();
        member.setHouseholdId(householdId);
        return member;
    }

    @Test
    void listIncomes_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        IncomeEntity income = new IncomeEntity();
        income.setId(1L);
        income.setHouseholdId(10L);
        income.setEarnerUserId(1L);
        income.setCategoryId(2L);
        income.setAmount(BigDecimal.valueOf(1000));
        income.setContent("給与");
        income.setIncomeDate(LocalDate.of(2026, 7, 25));
        when(incomeMapper.findByEarnerUserId(10L, 1L, null)).thenReturn(List.of(income));

        List<IncomeResponse> response = service().listIncomes(1L, null);

        assertThat(response).hasSize(1);
        assertThat(response.get(0).content()).isEqualTo("給与");
        verify(incomeMapper).findByEarnerUserId(10L, 1L, null);
    }

    @Test
    void createIncome_正常系() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        IncomeCategoryEntity category = new IncomeCategoryEntity();
        category.setId(2L);
        category.setHouseholdId(10L);
        when(incomeCategoryMapper.findById(2L)).thenReturn(category);
        CreateIncomeRequest request = new CreateIncomeRequest(
                LocalDate.of(2026, 7, 25), 100000L, "7月分給与", 2L, null);

        IncomeResponse response = service().createIncome(1L, request);

        assertThat(response.content()).isEqualTo("7月分給与");
        assertThat(response.amount()).isEqualByComparingTo(BigDecimal.valueOf(100000));
        verify(incomeMapper).insert(any(IncomeEntity.class));
    }

    @Test
    void createIncome_他世帯のカテゴリー指定は400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        IncomeCategoryEntity category = new IncomeCategoryEntity();
        category.setId(2L);
        category.setHouseholdId(999L);
        when(incomeCategoryMapper.findById(2L)).thenReturn(category);
        CreateIncomeRequest request = new CreateIncomeRequest(
                LocalDate.of(2026, 7, 25), 100000L, "7月分給与", 2L, null);

        assertThatThrownBy(() -> service().createIncome(1L, request)).isInstanceOf(BadRequestException.class);
    }

    @Test
    void createIncome_存在しないカテゴリー指定は400() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        when(incomeCategoryMapper.findById(2L)).thenReturn(null);
        CreateIncomeRequest request = new CreateIncomeRequest(
                LocalDate.of(2026, 7, 25), 100000L, "7月分給与", 2L, null);

        assertThatThrownBy(() -> service().createIncome(1L, request)).isInstanceOf(BadRequestException.class);
    }

    @Test
    void createIncome_earnerUserIdはリクエストに依らずログインユーザーに固定される() {
        when(householdMemberMapper.findByUserId(1L)).thenReturn(memberOf(10L));
        IncomeCategoryEntity category = new IncomeCategoryEntity();
        category.setId(2L);
        category.setHouseholdId(10L);
        when(incomeCategoryMapper.findById(2L)).thenReturn(category);
        CreateIncomeRequest request = new CreateIncomeRequest(
                LocalDate.of(2026, 7, 25), 100000L, "7月分給与", 2L, null);

        service().createIncome(1L, request);

        verify(incomeMapper).insert(argThatEarnerIs(1L));
    }

    private IncomeEntity argThatEarnerIs(long userId) {
        return org.mockito.ArgumentMatchers.argThat(entity -> entity.getEarnerUserId().equals(userId));
    }
}

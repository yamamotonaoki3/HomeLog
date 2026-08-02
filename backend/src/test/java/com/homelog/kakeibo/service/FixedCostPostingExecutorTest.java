package com.homelog.kakeibo.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.homelog.kakeibo.entity.ExpenseEntity;
import com.homelog.kakeibo.entity.FixedCostEntity;
import com.homelog.kakeibo.entity.KakeiboCategoryEntity;
import com.homelog.kakeibo.mapper.ExpenseMapper;
import com.homelog.kakeibo.mapper.KakeiboCategoryMapper;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class FixedCostPostingExecutorTest {

    @Mock
    private ExpenseMapper expenseMapper;
    @Mock
    private KakeiboCategoryMapper kakeiboCategoryMapper;

    private FixedCostPostingExecutor executor() {
        return new FixedCostPostingExecutor(expenseMapper, kakeiboCategoryMapper);
    }

    private FixedCostEntity fixedCost(long id, long householdId, long createdByUserId, String name,
            boolean includeInHouseholdTotal) {
        FixedCostEntity fixedCost = new FixedCostEntity();
        fixedCost.setId(id);
        fixedCost.setHouseholdId(householdId);
        fixedCost.setCreatedByUserId(createdByUserId);
        fixedCost.setName(name);
        fixedCost.setAmount(new BigDecimal("80000"));
        fixedCost.setPaymentDay(27);
        fixedCost.setIncludeInHouseholdTotal(includeInHouseholdTotal);
        fixedCost.setCreatedAt(LocalDateTime.now());
        return fixedCost;
    }

    private KakeiboCategoryEntity category(long id, long householdId) {
        KakeiboCategoryEntity category = new KakeiboCategoryEntity();
        category.setId(id);
        category.setHouseholdId(householdId);
        category.setName("固定費");
        category.setDefault(true);
        return category;
    }

    @Test
    void postSingleFixedCost_未計上なら支出として計上する() {
        FixedCostEntity fixedCost = fixedCost(1L, 10L, 100L, "家賃", true);
        LocalDate today = LocalDate.of(2026, 3, 27);
        when(expenseMapper.countByFixedCostIdAndMonth(1L, 2026, 3)).thenReturn(0);
        when(kakeiboCategoryMapper.findByHouseholdIdAndName(10L, "固定費")).thenReturn(category(5L, 10L));

        executor().postSingleFixedCost(fixedCost, today);

        ArgumentCaptor<ExpenseEntity> captor = ArgumentCaptor.forClass(ExpenseEntity.class);
        verify(expenseMapper).insert(captor.capture());
        ExpenseEntity inserted = captor.getValue();
        assertThat(inserted.getHouseholdId()).isEqualTo(10L);
        assertThat(inserted.getPayerUserId()).isEqualTo(100L);
        assertThat(inserted.getCategoryId()).isEqualTo(5L);
        assertThat(inserted.getFixedCostId()).isEqualTo(1L);
        assertThat(inserted.getAmount()).isEqualByComparingTo("80000");
        assertThat(inserted.getPurpose()).isEqualTo("家賃");
        assertThat(inserted.getExpenseDate()).isEqualTo(today);
        assertThat(inserted.isIncludeInHouseholdTotal()).isTrue();
    }

    @Test
    void postSingleFixedCost_既に当月分が計上済みならスキップする() {
        FixedCostEntity fixedCost = fixedCost(2L, 10L, 100L, "家賃", true);
        when(expenseMapper.countByFixedCostIdAndMonth(2L, 2026, 3)).thenReturn(1);

        executor().postSingleFixedCost(fixedCost, LocalDate.of(2026, 3, 27));

        verify(expenseMapper, never()).insert(any());
    }

    @Test
    void postSingleFixedCost_固定費カテゴリーが存在しない場合は例外をスローする() {
        FixedCostEntity fixedCost = fixedCost(3L, 10L, 100L, "家賃", true);
        when(expenseMapper.countByFixedCostIdAndMonth(3L, 2026, 3)).thenReturn(0);
        when(kakeiboCategoryMapper.findByHouseholdIdAndName(10L, "固定費")).thenReturn(null);

        assertThatThrownBy(() -> executor().postSingleFixedCost(fixedCost, LocalDate.of(2026, 3, 27)))
                .isInstanceOf(IllegalStateException.class);
        verify(expenseMapper, never()).insert(any());
    }
}

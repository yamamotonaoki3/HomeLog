package com.homelog.kakeibo.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.homelog.kakeibo.entity.FixedCostEntity;
import com.homelog.kakeibo.mapper.FixedCostMapper;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class FixedCostPostingServiceTest {

    @Mock
    private FixedCostMapper fixedCostMapper;
    @Mock
    private FixedCostPostingExecutor executor;

    private FixedCostPostingService service() {
        return new FixedCostPostingService(fixedCostMapper, executor);
    }

    private FixedCostEntity fixedCost(long id) {
        FixedCostEntity fixedCost = new FixedCostEntity();
        fixedCost.setId(id);
        fixedCost.setHouseholdId(10L);
        fixedCost.setCreatedByUserId(100L);
        fixedCost.setName("固定費" + id);
        fixedCost.setPaymentDay(27);
        fixedCost.setCreatedAt(LocalDateTime.now());
        return fixedCost;
    }

    @Test
    void postForDate_通常の日は当日の日付をそのままday_lastDayOfMonthとして問い合わせる() {
        LocalDate today = LocalDate.of(2026, 3, 27);
        when(fixedCostMapper.findDueForPosting(27, 31)).thenReturn(List.of());

        service().postForDate(today);

        verify(fixedCostMapper).findDueForPosting(27, 31);
    }

    @Test
    void postForDate_月末は月の最終日をlastDayOfMonthとして問い合わせる() {
        LocalDate today = LocalDate.of(2026, 2, 28);
        when(fixedCostMapper.findDueForPosting(28, 28)).thenReturn(List.of());

        service().postForDate(today);

        verify(fixedCostMapper).findDueForPosting(28, 28);
    }

    @Test
    void postForDate_対象の固定費全てについて計上処理を呼び出す() {
        LocalDate today = LocalDate.of(2026, 3, 27);
        FixedCostEntity fixedCost1 = fixedCost(1L);
        FixedCostEntity fixedCost2 = fixedCost(2L);
        when(fixedCostMapper.findDueForPosting(27, 31)).thenReturn(List.of(fixedCost1, fixedCost2));

        service().postForDate(today);

        verify(executor).postSingleFixedCost(fixedCost1, today);
        verify(executor).postSingleFixedCost(fixedCost2, today);
    }

    @Test
    void postForDate_1件の計上失敗が他の固定費の計上を妨げない() {
        LocalDate today = LocalDate.of(2026, 3, 27);
        FixedCostEntity fixedCost1 = fixedCost(1L);
        FixedCostEntity fixedCost2 = fixedCost(2L);
        when(fixedCostMapper.findDueForPosting(27, 31)).thenReturn(List.of(fixedCost1, fixedCost2));
        doThrow(new IllegalStateException("失敗")).when(executor).postSingleFixedCost(eq(fixedCost1), any());
        doNothing().when(executor).postSingleFixedCost(eq(fixedCost2), any());

        service().postForDate(today);

        verify(executor, times(1)).postSingleFixedCost(fixedCost1, today);
        verify(executor, times(1)).postSingleFixedCost(fixedCost2, today);
    }
}

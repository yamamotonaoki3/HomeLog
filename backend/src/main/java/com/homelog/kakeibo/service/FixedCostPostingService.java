package com.homelog.kakeibo.service;

import com.homelog.kakeibo.entity.FixedCostEntity;
import com.homelog.kakeibo.mapper.FixedCostMapper;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class FixedCostPostingService {

    private static final Logger LOGGER = LoggerFactory.getLogger(FixedCostPostingService.class);
    private static final ZoneId ASIA_TOKYO = ZoneId.of("Asia/Tokyo");

    private final FixedCostMapper fixedCostMapper;
    private final FixedCostPostingExecutor executor;

    public FixedCostPostingService(FixedCostMapper fixedCostMapper, FixedCostPostingExecutor executor) {
        this.fixedCostMapper = fixedCostMapper;
        this.executor = executor;
    }

    @Scheduled(cron = "0 0 1 * * *", zone = "Asia/Tokyo")
    public void runMonthlyPosting() {
        postForDate(LocalDate.now(ASIA_TOKYO));
    }

    public void postForDate(LocalDate today) {
        int day = today.getDayOfMonth();
        int lastDayOfMonth = today.lengthOfMonth();
        List<FixedCostEntity> dueFixedCosts = fixedCostMapper.findDueForPosting(day, lastDayOfMonth);
        for (FixedCostEntity fixedCost : dueFixedCosts) {
            try {
                executor.postSingleFixedCost(fixedCost, today);
            } catch (RuntimeException e) {
                LOGGER.error("固定費の自動計上に失敗しました。fixedCostId={}", fixedCost.getId(), e);
            }
        }
    }
}

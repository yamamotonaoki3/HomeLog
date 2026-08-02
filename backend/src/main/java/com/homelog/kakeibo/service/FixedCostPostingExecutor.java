package com.homelog.kakeibo.service;

import com.homelog.kakeibo.entity.ExpenseEntity;
import com.homelog.kakeibo.entity.FixedCostEntity;
import com.homelog.kakeibo.mapper.ExpenseMapper;
import java.time.LocalDate;
import java.time.LocalDateTime;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FixedCostPostingExecutor {

    private static final String FIXED_COST_CATEGORY_NAME = "固定費";

    private final ExpenseMapper expenseMapper;
    private final KakeiboCategoryService kakeiboCategoryService;

    public FixedCostPostingExecutor(ExpenseMapper expenseMapper, KakeiboCategoryService kakeiboCategoryService) {
        this.expenseMapper = expenseMapper;
        this.kakeiboCategoryService = kakeiboCategoryService;
    }

    @Transactional
    public void postSingleFixedCost(FixedCostEntity fixedCost, LocalDate today) {
        int alreadyPosted = expenseMapper.countByFixedCostIdAndMonth(fixedCost.getId(), today.getYear(),
                today.getMonthValue());
        if (alreadyPosted > 0) {
            return;
        }
        Long categoryId = kakeiboCategoryService.resolveDefaultCategoryId(fixedCost.getHouseholdId(),
                FIXED_COST_CATEGORY_NAME);
        ExpenseEntity expense = new ExpenseEntity();
        expense.setHouseholdId(fixedCost.getHouseholdId());
        expense.setPayerUserId(fixedCost.getCreatedByUserId());
        expense.setCategoryId(categoryId);
        expense.setFixedCostId(fixedCost.getId());
        expense.setFixedCostYearMonth(String.format("%04d-%02d", today.getYear(), today.getMonthValue()));
        expense.setAmount(fixedCost.getAmount());
        expense.setPurpose(fixedCost.getName());
        expense.setExpenseDate(today);
        expense.setIncludeInHouseholdTotal(fixedCost.isIncludeInHouseholdTotal());
        expense.setCreatedAt(LocalDateTime.now());
        try {
            expenseMapper.insert(expense);
        } catch (DuplicateKeyException exception) {
            // 他のアプリケーションインスタンスが同じ固定費の当月分を先に計上済み。
        }
    }
}

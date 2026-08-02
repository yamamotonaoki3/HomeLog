package com.homelog.kakeibo.service;

import com.homelog.kakeibo.entity.ExpenseEntity;
import com.homelog.kakeibo.entity.FixedCostEntity;
import com.homelog.kakeibo.entity.KakeiboCategoryEntity;
import com.homelog.kakeibo.mapper.ExpenseMapper;
import com.homelog.kakeibo.mapper.KakeiboCategoryMapper;
import java.time.LocalDate;
import java.time.LocalDateTime;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FixedCostPostingExecutor {

    private static final String FIXED_COST_CATEGORY_NAME = "固定費";

    private final ExpenseMapper expenseMapper;
    private final KakeiboCategoryMapper kakeiboCategoryMapper;

    public FixedCostPostingExecutor(ExpenseMapper expenseMapper, KakeiboCategoryMapper kakeiboCategoryMapper) {
        this.expenseMapper = expenseMapper;
        this.kakeiboCategoryMapper = kakeiboCategoryMapper;
    }

    @Transactional
    public void postSingleFixedCost(FixedCostEntity fixedCost, LocalDate today) {
        int alreadyPosted = expenseMapper.countByFixedCostIdAndMonth(fixedCost.getId(), today.getYear(),
                today.getMonthValue());
        if (alreadyPosted > 0) {
            return;
        }
        KakeiboCategoryEntity category = kakeiboCategoryMapper.findByHouseholdIdAndName(fixedCost.getHouseholdId(),
                FIXED_COST_CATEGORY_NAME);
        if (category == null) {
            throw new IllegalStateException(
                    "固定費カテゴリーが見つかりません。householdId=" + fixedCost.getHouseholdId());
        }
        ExpenseEntity expense = new ExpenseEntity();
        expense.setHouseholdId(fixedCost.getHouseholdId());
        expense.setPayerUserId(fixedCost.getCreatedByUserId());
        expense.setCategoryId(category.getId());
        expense.setFixedCostId(fixedCost.getId());
        expense.setAmount(fixedCost.getAmount());
        expense.setPurpose(fixedCost.getName());
        expense.setExpenseDate(today);
        expense.setIncludeInHouseholdTotal(fixedCost.isIncludeInHouseholdTotal());
        expense.setCreatedAt(LocalDateTime.now());
        expenseMapper.insert(expense);
    }
}

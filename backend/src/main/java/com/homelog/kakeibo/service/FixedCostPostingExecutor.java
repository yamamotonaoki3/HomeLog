package com.homelog.kakeibo.service;

import com.homelog.kakeibo.entity.AccountEntity;
import com.homelog.kakeibo.entity.CardEntity;
import com.homelog.kakeibo.entity.ExpenseEntity;
import com.homelog.kakeibo.entity.FixedCostEntity;
import com.homelog.kakeibo.mapper.CardMapper;
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
    private final CardMapper cardMapper;
    private final AccountService accountService;
    private final CardService cardService;

    public FixedCostPostingExecutor(ExpenseMapper expenseMapper, KakeiboCategoryService kakeiboCategoryService,
            CardMapper cardMapper, AccountService accountService, CardService cardService) {
        this.expenseMapper = expenseMapper;
        this.kakeiboCategoryService = kakeiboCategoryService;
        this.cardMapper = cardMapper;
        this.accountService = accountService;
        this.cardService = cardService;
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
            if (fixedCost.getCardId() != null) {
                postWithCard(fixedCost, expense);
            } else if (fixedCost.getAccountId() != null) {
                postWithAccount(fixedCost, expense);
            } else {
                expenseMapper.insert(expense);
            }
        } catch (DuplicateKeyException exception) {
            // 他のアプリケーションインスタンスが同じ固定費の当月分を先に計上済み。
        }
    }

    private void postWithCard(FixedCostEntity fixedCost, ExpenseEntity expense) {
        CardEntity card = cardMapper.findById(fixedCost.getCardId());
        if (card == null) {
            throw new IllegalStateException("引き落とし元のカードが見つかりません。cardId=" + fixedCost.getCardId());
        }
        if ("charge".equals(card.getCardType())) {
            CardEntity lockedCard = cardService.lockCardForUpdate(fixedCost.getCardId());
            expense.setCardId(fixedCost.getCardId());
            expenseMapper.insert(expense);
            cardService.updateBalance(fixedCost.getCardId(), lockedCard.getBalance().subtract(fixedCost.getAmount()));
        } else {
            AccountEntity lockedAccount = accountService.lockAccountForUpdate(card.getAccountId());
            expense.setAccountId(card.getAccountId());
            expenseMapper.insert(expense);
            accountService.updateBalance(card.getAccountId(),
                    lockedAccount.getBalance().subtract(fixedCost.getAmount()));
        }
    }

    private void postWithAccount(FixedCostEntity fixedCost, ExpenseEntity expense) {
        AccountEntity lockedAccount = accountService.lockAccountForUpdate(fixedCost.getAccountId());
        expense.setAccountId(fixedCost.getAccountId());
        expenseMapper.insert(expense);
        accountService.updateBalance(fixedCost.getAccountId(),
                lockedAccount.getBalance().subtract(fixedCost.getAmount()));
    }
}

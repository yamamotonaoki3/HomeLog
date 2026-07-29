package com.homelog.kakeibo.service;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.kakeibo.dto.request.CreateExpenseRequest;
import com.homelog.kakeibo.dto.response.ExpenseResponse;
import com.homelog.kakeibo.entity.AccountEntity;
import com.homelog.kakeibo.entity.ExpenseEntity;
import com.homelog.kakeibo.entity.KakeiboCategoryEntity;
import com.homelog.kakeibo.mapper.ExpenseMapper;
import com.homelog.kakeibo.mapper.KakeiboCategoryMapper;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ExpenseService {

    private static final String CATEGORY_NOT_FOUND_MESSAGE = "指定されたカテゴリーが見つかりません";
    private static final String ACCOUNT_AND_CARD_BOTH_SPECIFIED_MESSAGE = "口座とカードは同時に指定できません";

    private final ExpenseMapper expenseMapper;
    private final KakeiboCategoryMapper kakeiboCategoryMapper;
    private final HouseholdMemberMapper householdMemberMapper;
    private final AccountService accountService;

    public ExpenseService(ExpenseMapper expenseMapper, KakeiboCategoryMapper kakeiboCategoryMapper,
            HouseholdMemberMapper householdMemberMapper, AccountService accountService) {
        this.expenseMapper = expenseMapper;
        this.kakeiboCategoryMapper = kakeiboCategoryMapper;
        this.householdMemberMapper = householdMemberMapper;
        this.accountService = accountService;
    }

    public List<ExpenseResponse> listExpenses(Long userId, Long categoryId) {
        Long householdId = resolveHouseholdId(userId);
        return expenseMapper.findByPayerUserId(householdId, userId, categoryId).stream()
                .map(this::toResponse).toList();
    }

    @Transactional
    public ExpenseResponse createExpense(Long userId, CreateExpenseRequest request) {
        Long householdId = resolveHouseholdId(userId);
        validateCategory(householdId, request.categoryId());
        Long resolvedAccountId = resolveAccountId(userId, householdId, request);

        BigDecimal amount = BigDecimal.valueOf(request.amount());
        AccountEntity lockedAccount = null;
        if (resolvedAccountId != null) {
            // 支出INSERTのFK参照チェックが先に口座行の共有ロックを取得すると、後続のFOR UPDATEへの
            // ロック昇格が競合しデッドロックしうるため、INSERT前に排他ロックを取得しておく。
            lockedAccount = accountService.lockAccountForUpdate(resolvedAccountId);
        }

        ExpenseEntity expense = new ExpenseEntity();
        expense.setHouseholdId(householdId);
        expense.setPayerUserId(userId);
        expense.setCategoryId(request.categoryId());
        expense.setAccountId(resolvedAccountId);
        expense.setAmount(amount);
        expense.setPurpose(request.purpose());
        expense.setMemo(request.memo());
        expense.setExpenseDate(request.expenseDate());
        expense.setIncludeInHouseholdTotal(Boolean.TRUE.equals(request.includeInHouseholdTotal()));
        expense.setCreatedAt(LocalDateTime.now());
        expenseMapper.insert(expense);
        if (lockedAccount != null) {
            accountService.updateBalance(resolvedAccountId, lockedAccount.getBalance().subtract(amount));
        }
        return toResponse(expense);
    }

    private Long resolveAccountId(Long userId, Long householdId, CreateExpenseRequest request) {
        if (request.accountId() != null && request.cardId() != null) {
            throw new BadRequestException(ACCOUNT_AND_CARD_BOTH_SPECIFIED_MESSAGE);
        }
        if (request.cardId() != null) {
            return accountService.resolveAccountIdFromCard(userId, householdId, request.cardId());
        }
        if (request.accountId() != null) {
            accountService.validateOwnedAccountForExpense(userId, householdId, request.accountId());
            return request.accountId();
        }
        return null;
    }

    private void validateCategory(Long householdId, Long categoryId) {
        KakeiboCategoryEntity category = kakeiboCategoryMapper.findById(categoryId);
        if (category == null || !category.getHouseholdId().equals(householdId)) {
            throw new BadRequestException(CATEGORY_NOT_FOUND_MESSAGE);
        }
    }

    private Long resolveHouseholdId(Long userId) {
        var member = householdMemberMapper.findByUserId(userId);
        if (member == null) {
            throw new ResourceNotFoundException("世帯グループが見つかりません");
        }
        return member.getHouseholdId();
    }

    private ExpenseResponse toResponse(ExpenseEntity expense) {
        return new ExpenseResponse(expense.getId(), expense.getExpenseDate(), expense.getAmount(),
                expense.getPurpose(), expense.getCategoryId(), expense.getMemo(),
                expense.isIncludeInHouseholdTotal(), expense.getAccountId());
    }
}

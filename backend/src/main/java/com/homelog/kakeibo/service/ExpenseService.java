package com.homelog.kakeibo.service;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.kakeibo.dto.request.CreateExpenseRequest;
import com.homelog.kakeibo.dto.response.ExpenseResponse;
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
        if (request.accountId() != null) {
            accountService.validateOwnedAccountForExpense(userId, householdId, request.accountId());
        }

        ExpenseEntity expense = new ExpenseEntity();
        expense.setHouseholdId(householdId);
        expense.setPayerUserId(userId);
        expense.setCategoryId(request.categoryId());
        expense.setAccountId(request.accountId());
        expense.setAmount(BigDecimal.valueOf(request.amount()));
        expense.setPurpose(request.purpose());
        expense.setMemo(request.memo());
        expense.setExpenseDate(request.expenseDate());
        expense.setIncludeInHouseholdTotal(Boolean.TRUE.equals(request.includeInHouseholdTotal()));
        expense.setCreatedAt(LocalDateTime.now());
        expenseMapper.insert(expense);
        if (request.accountId() != null) {
            accountService.decrementBalance(request.accountId(), expense.getAmount());
        }
        return toResponse(expense);
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

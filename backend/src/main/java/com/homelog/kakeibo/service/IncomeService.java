package com.homelog.kakeibo.service;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.kakeibo.dto.request.CreateIncomeRequest;
import com.homelog.kakeibo.dto.response.IncomeResponse;
import com.homelog.kakeibo.entity.IncomeCategoryEntity;
import com.homelog.kakeibo.entity.IncomeEntity;
import com.homelog.kakeibo.mapper.IncomeCategoryMapper;
import com.homelog.kakeibo.mapper.IncomeMapper;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IncomeService {

    private static final String CATEGORY_NOT_FOUND_MESSAGE = "指定されたカテゴリーが見つかりません";

    private final IncomeMapper incomeMapper;
    private final IncomeCategoryMapper incomeCategoryMapper;
    private final HouseholdMemberMapper householdMemberMapper;

    public IncomeService(IncomeMapper incomeMapper, IncomeCategoryMapper incomeCategoryMapper,
            HouseholdMemberMapper householdMemberMapper) {
        this.incomeMapper = incomeMapper;
        this.incomeCategoryMapper = incomeCategoryMapper;
        this.householdMemberMapper = householdMemberMapper;
    }

    public List<IncomeResponse> listIncomes(Long userId, Long categoryId) {
        Long householdId = resolveHouseholdId(userId);
        return incomeMapper.findByEarnerUserId(householdId, userId, categoryId).stream()
                .map(this::toResponse).toList();
    }

    @Transactional
    public IncomeResponse createIncome(Long userId, CreateIncomeRequest request) {
        Long householdId = resolveHouseholdId(userId);
        validateCategory(householdId, request.categoryId());

        IncomeEntity income = new IncomeEntity();
        income.setHouseholdId(householdId);
        income.setEarnerUserId(userId);
        income.setCategoryId(request.categoryId());
        income.setAmount(BigDecimal.valueOf(request.amount()));
        income.setContent(request.content());
        income.setMemo(request.memo());
        income.setIncomeDate(request.incomeDate());
        income.setCreatedAt(LocalDateTime.now());
        incomeMapper.insert(income);
        return toResponse(income);
    }

    private void validateCategory(Long householdId, Long categoryId) {
        IncomeCategoryEntity category = incomeCategoryMapper.findById(categoryId);
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

    private IncomeResponse toResponse(IncomeEntity income) {
        return new IncomeResponse(income.getId(), income.getIncomeDate(), income.getAmount(),
                income.getContent(), income.getCategoryId(), income.getMemo());
    }
}

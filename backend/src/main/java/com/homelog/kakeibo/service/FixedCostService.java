package com.homelog.kakeibo.service;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.kakeibo.dto.request.CreateFixedCostRequest;
import com.homelog.kakeibo.dto.request.UpdateFixedCostRequest;
import com.homelog.kakeibo.dto.response.FixedCostResponse;
import com.homelog.kakeibo.entity.FixedCostEntity;
import com.homelog.kakeibo.mapper.FixedCostMapper;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class FixedCostService {

    private static final String NOT_FOUND_MESSAGE = "固定費が見つかりません";
    private static final String ACCOUNT_AND_CARD_BOTH_SPECIFIED_MESSAGE = "口座とカードは同時に指定できません";

    private final FixedCostMapper fixedCostMapper;
    private final HouseholdMemberMapper householdMemberMapper;
    private final AccountService accountService;

    public FixedCostService(FixedCostMapper fixedCostMapper, HouseholdMemberMapper householdMemberMapper,
            AccountService accountService) {
        this.fixedCostMapper = fixedCostMapper;
        this.householdMemberMapper = householdMemberMapper;
        this.accountService = accountService;
    }

    public List<FixedCostResponse> listFixedCosts(Long userId) {
        Long householdId = resolveHouseholdId(userId);
        return fixedCostMapper.findVisibleByHouseholdIdAndUserId(householdId, userId).stream()
                .map(fixedCost -> toResponse(fixedCost, userId))
                .toList();
    }

    public FixedCostResponse createFixedCost(Long userId, CreateFixedCostRequest request) {
        Long householdId = resolveHouseholdId(userId);
        validateAndResolveAccountOrCard(userId, householdId, request.accountId(), request.cardId());
        FixedCostEntity fixedCost = new FixedCostEntity();
        fixedCost.setHouseholdId(householdId);
        fixedCost.setOwnerUserId(Boolean.TRUE.equals(request.personal()) ? userId : null);
        fixedCost.setCreatedByUserId(userId);
        fixedCost.setAccountId(request.accountId());
        fixedCost.setCardId(request.cardId());
        fixedCost.setName(request.name());
        fixedCost.setAmount(BigDecimal.valueOf(request.amount()));
        fixedCost.setPaymentDay(request.paymentDay());
        fixedCost.setIncludeInHouseholdTotal(Boolean.TRUE.equals(request.includeInHouseholdTotal()));
        fixedCost.setCreatedAt(LocalDateTime.now());
        fixedCostMapper.insert(fixedCost);
        return toResponse(fixedCost, userId);
    }

    public FixedCostResponse updateFixedCost(Long userId, Long fixedCostId, UpdateFixedCostRequest request) {
        Long householdId = resolveHouseholdId(userId);
        FixedCostEntity fixedCost = findEditable(userId, householdId, fixedCostId);
        validateAndResolveAccountOrCard(userId, householdId, request.accountId(), request.cardId());
        Long ownerUserId = Boolean.TRUE.equals(request.personal()) ? userId : null;
        BigDecimal amount = BigDecimal.valueOf(request.amount());
        boolean includeInHouseholdTotal = Boolean.TRUE.equals(request.includeInHouseholdTotal());
        fixedCostMapper.update(fixedCostId, request.name(), amount, request.paymentDay(), ownerUserId,
                includeInHouseholdTotal, request.accountId(), request.cardId());
        fixedCost.setName(request.name());
        fixedCost.setAmount(amount);
        fixedCost.setPaymentDay(request.paymentDay());
        fixedCost.setOwnerUserId(ownerUserId);
        fixedCost.setIncludeInHouseholdTotal(includeInHouseholdTotal);
        fixedCost.setAccountId(request.accountId());
        fixedCost.setCardId(request.cardId());
        return toResponse(fixedCost, userId);
    }

    public void deleteFixedCost(Long userId, Long fixedCostId) {
        Long householdId = resolveHouseholdId(userId);
        findEditable(userId, householdId, fixedCostId);
        fixedCostMapper.delete(fixedCostId);
    }

    private void validateAndResolveAccountOrCard(Long userId, Long householdId, Long accountId, Long cardId) {
        if (accountId != null && cardId != null) {
            throw new BadRequestException(ACCOUNT_AND_CARD_BOTH_SPECIFIED_MESSAGE);
        }
        if (cardId != null) {
            accountService.findOwnedCardForExpense(userId, householdId, cardId);
        } else if (accountId != null) {
            accountService.validateOwnedAccountForExpense(userId, householdId, accountId);
        }
    }

    private FixedCostEntity findEditable(Long userId, Long householdId, Long fixedCostId) {
        FixedCostEntity fixedCost = fixedCostMapper.findById(fixedCostId);
        if (fixedCost == null || !fixedCost.getHouseholdId().equals(householdId)
                || !fixedCost.getCreatedByUserId().equals(userId)) {
            throw new ResourceNotFoundException(NOT_FOUND_MESSAGE);
        }
        return fixedCost;
    }

    private Long resolveHouseholdId(Long userId) {
        var member = householdMemberMapper.findByUserId(userId);
        if (member == null) {
            throw new ResourceNotFoundException("世帯グループが見つかりません");
        }
        return member.getHouseholdId();
    }

    private FixedCostResponse toResponse(FixedCostEntity fixedCost, Long userId) {
        boolean personal = fixedCost.getOwnerUserId() != null;
        boolean editable = fixedCost.getCreatedByUserId().equals(userId);
        return new FixedCostResponse(fixedCost.getId(), fixedCost.getName(), fixedCost.getAmount(),
                fixedCost.getPaymentDay(), personal, fixedCost.isIncludeInHouseholdTotal(), editable,
                fixedCost.getAccountId(), fixedCost.getCardId());
    }
}

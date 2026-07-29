package com.homelog.kakeibo.service;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.kakeibo.dto.request.CreateCardRequest;
import com.homelog.kakeibo.dto.request.UpdateCardRequest;
import com.homelog.kakeibo.dto.response.CardResponse;
import com.homelog.kakeibo.entity.AccountEntity;
import com.homelog.kakeibo.entity.CardEntity;
import com.homelog.kakeibo.mapper.AccountMapper;
import com.homelog.kakeibo.mapper.CardMapper;
import java.time.LocalDateTime;
import org.springframework.stereotype.Service;

@Service
public class CardService {

    private static final String NOT_FOUND_MESSAGE = "カードが見つかりません";
    private static final String INVALID_ACCOUNT_MESSAGE = "指定された口座が見つかりません";

    private final CardMapper cardMapper;
    private final AccountMapper accountMapper;
    private final HouseholdMemberMapper householdMemberMapper;

    public CardService(CardMapper cardMapper, AccountMapper accountMapper,
            HouseholdMemberMapper householdMemberMapper) {
        this.cardMapper = cardMapper;
        this.accountMapper = accountMapper;
        this.householdMemberMapper = householdMemberMapper;
    }

    public CardResponse createCard(Long userId, CreateCardRequest request) {
        Long householdId = resolveHouseholdId(userId);
        validateOwnedAccount(userId, householdId, request.accountId());
        CardEntity card = new CardEntity();
        card.setAccountId(request.accountId());
        card.setName(request.name());
        card.setCreatedAt(LocalDateTime.now());
        cardMapper.insert(card);
        return toResponse(card);
    }

    public CardResponse updateCard(Long userId, Long cardId, UpdateCardRequest request) {
        Long householdId = resolveHouseholdId(userId);
        CardEntity card = findOwnedCard(userId, householdId, cardId);
        cardMapper.update(cardId, request.name());
        card.setName(request.name());
        return toResponse(card);
    }

    public void deleteCard(Long userId, Long cardId) {
        Long householdId = resolveHouseholdId(userId);
        findOwnedCard(userId, householdId, cardId);
        cardMapper.delete(cardId);
    }

    private void validateOwnedAccount(Long userId, Long householdId, Long accountId) {
        AccountEntity account = accountMapper.findById(accountId);
        if (account == null || !account.getOwnerUserId().equals(userId)
                || !account.getHouseholdId().equals(householdId)) {
            throw new BadRequestException(INVALID_ACCOUNT_MESSAGE);
        }
    }

    private CardEntity findOwnedCard(Long userId, Long householdId, Long cardId) {
        CardEntity card = cardMapper.findById(cardId);
        if (card == null) {
            throw new ResourceNotFoundException(NOT_FOUND_MESSAGE);
        }
        AccountEntity account = accountMapper.findById(card.getAccountId());
        if (account == null || !account.getOwnerUserId().equals(userId)
                || !account.getHouseholdId().equals(householdId)) {
            throw new ResourceNotFoundException(NOT_FOUND_MESSAGE);
        }
        return card;
    }

    private Long resolveHouseholdId(Long userId) {
        var member = householdMemberMapper.findByUserId(userId);
        if (member == null) {
            throw new ResourceNotFoundException("世帯グループが見つかりません");
        }
        return member.getHouseholdId();
    }

    private CardResponse toResponse(CardEntity card) {
        return new CardResponse(card.getId(), card.getName(), card.getAccountId());
    }
}

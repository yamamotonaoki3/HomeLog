package com.homelog.kakeibo.service;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.kakeibo.dto.request.ChargeCardRequest;
import com.homelog.kakeibo.dto.request.CreateCardRequest;
import com.homelog.kakeibo.dto.request.UpdateCardRequest;
import com.homelog.kakeibo.dto.response.CardResponse;
import com.homelog.kakeibo.dto.response.ChargeResponse;
import com.homelog.kakeibo.entity.AccountEntity;
import com.homelog.kakeibo.entity.CardChargeEntity;
import com.homelog.kakeibo.entity.CardEntity;
import com.homelog.kakeibo.mapper.AccountMapper;
import com.homelog.kakeibo.mapper.CardChargeMapper;
import com.homelog.kakeibo.mapper.CardMapper;
import com.homelog.kakeibo.mapper.ExpenseMapper;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CardService {

    private static final String NOT_FOUND_MESSAGE = "カードが見つかりません";
    private static final String INVALID_ACCOUNT_MESSAGE = "指定された口座が見つかりません";
    private static final String IN_USE_MESSAGE = "使用中のカードは削除できません";
    private static final String NOT_CHARGE_CARD_MESSAGE = "チャージ型カードではありません";

    private final CardMapper cardMapper;
    private final AccountMapper accountMapper;
    private final CardChargeMapper cardChargeMapper;
    private final ExpenseMapper expenseMapper;
    private final HouseholdMemberMapper householdMemberMapper;

    public CardService(CardMapper cardMapper, AccountMapper accountMapper, CardChargeMapper cardChargeMapper,
            ExpenseMapper expenseMapper, HouseholdMemberMapper householdMemberMapper) {
        this.cardMapper = cardMapper;
        this.accountMapper = accountMapper;
        this.cardChargeMapper = cardChargeMapper;
        this.expenseMapper = expenseMapper;
        this.householdMemberMapper = householdMemberMapper;
    }

    public CardResponse createCard(Long userId, CreateCardRequest request) {
        Long householdId = resolveHouseholdId(userId);
        validateOwnedAccount(userId, householdId, request.accountId());
        CardEntity card = new CardEntity();
        card.setAccountId(request.accountId());
        card.setName(request.name());
        card.setCardType(request.cardType());
        card.setCreatedAt(LocalDateTime.now());
        cardMapper.insert(card);
        card.setBalance(BigDecimal.ZERO);
        return toResponse(card);
    }

    public CardResponse updateCard(Long userId, Long cardId, UpdateCardRequest request) {
        Long householdId = resolveHouseholdId(userId);
        CardEntity card = findOwnedCard(userId, householdId, cardId);
        cardMapper.update(cardId, request.name());
        card.setName(request.name());
        return toResponse(card);
    }

    @Transactional
    public void deleteCard(Long userId, Long cardId) {
        Long householdId = resolveHouseholdId(userId);
        findOwnedCard(userId, householdId, cardId);
        cardMapper.lockById(cardId);
        if (expenseMapper.countByCardId(cardId) > 0 || cardChargeMapper.countByCardId(cardId) > 0) {
            throw new BadRequestException(IN_USE_MESSAGE);
        }
        cardMapper.delete(cardId);
    }

    @Transactional
    public ChargeResponse chargeCard(Long userId, Long cardId, ChargeCardRequest request) {
        Long householdId = resolveHouseholdId(userId);
        CardEntity card = findOwnedCard(userId, householdId, cardId);
        if (!"charge".equals(card.getCardType())) {
            throw new BadRequestException(NOT_CHARGE_CARD_MESSAGE);
        }
        validateOwnedAccount(userId, householdId, request.fromAccountId());

        // ロック順序は常に「口座→カード」の順に統一する（ExpenseServiceの
        // 支出登録時のロック取得方針と揃え、カードが絡む機能間でのデッドロックを防ぐ）。
        AccountEntity lockedAccount = accountMapper.lockById(request.fromAccountId());
        CardEntity lockedCard = cardMapper.lockById(cardId);

        BigDecimal amount = BigDecimal.valueOf(request.amount());
        CardChargeEntity charge = new CardChargeEntity();
        charge.setCardId(cardId);
        charge.setFromAccountId(request.fromAccountId());
        charge.setAmount(amount);
        charge.setCreatedAt(LocalDateTime.now());
        cardChargeMapper.insert(charge);

        BigDecimal accountBalanceAfter = lockedAccount.getBalance().subtract(amount);
        BigDecimal cardBalanceAfter = lockedCard.getBalance().add(amount);
        accountMapper.updateBalance(request.fromAccountId(), accountBalanceAfter);
        cardMapper.updateBalance(cardId, cardBalanceAfter);

        return new ChargeResponse(charge.getId(), cardId, request.fromAccountId(), amount, cardBalanceAfter,
                accountBalanceAfter, charge.getCreatedAt());
    }

    public CardEntity lockCardForUpdate(Long cardId) {
        CardEntity card = cardMapper.lockById(cardId);
        if (card == null) {
            throw new BadRequestException(NOT_FOUND_MESSAGE);
        }
        return card;
    }

    public void updateBalance(Long cardId, BigDecimal balance) {
        cardMapper.updateBalance(cardId, balance);
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
        return new CardResponse(card.getId(), card.getName(), card.getAccountId(), card.getCardType(),
                card.getBalance());
    }
}

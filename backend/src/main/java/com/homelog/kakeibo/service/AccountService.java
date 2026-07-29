package com.homelog.kakeibo.service;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.household.mapper.HouseholdMemberMapper;
import com.homelog.kakeibo.dto.request.CreateAccountRequest;
import com.homelog.kakeibo.dto.request.UpdateAccountRequest;
import com.homelog.kakeibo.dto.response.AccountResponse;
import com.homelog.kakeibo.dto.response.CardResponse;
import com.homelog.kakeibo.entity.AccountEntity;
import com.homelog.kakeibo.mapper.AccountMapper;
import com.homelog.kakeibo.mapper.CardMapper;
import com.homelog.kakeibo.mapper.ExpenseMapper;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccountService {

    private static final String NOT_FOUND_MESSAGE = "口座が見つかりません";
    private static final String IN_USE_MESSAGE = "使用中の口座は削除できません";
    private static final String INVALID_ACCOUNT_MESSAGE = "指定された口座が見つかりません";

    private final AccountMapper accountMapper;
    private final CardMapper cardMapper;
    private final ExpenseMapper expenseMapper;
    private final HouseholdMemberMapper householdMemberMapper;

    public AccountService(AccountMapper accountMapper, CardMapper cardMapper, ExpenseMapper expenseMapper,
            HouseholdMemberMapper householdMemberMapper) {
        this.accountMapper = accountMapper;
        this.cardMapper = cardMapper;
        this.expenseMapper = expenseMapper;
        this.householdMemberMapper = householdMemberMapper;
    }

    public List<AccountResponse> listAccounts(Long userId) {
        Long householdId = resolveHouseholdId(userId);
        return accountMapper.findByHouseholdIdAndOwnerUserId(householdId, userId).stream()
                .map(this::toResponse).toList();
    }

    public AccountResponse createAccount(Long userId, CreateAccountRequest request) {
        Long householdId = resolveHouseholdId(userId);
        AccountEntity account = new AccountEntity();
        account.setHouseholdId(householdId);
        account.setOwnerUserId(userId);
        account.setName(request.name());
        account.setType(request.type());
        account.setBalance(BigDecimal.valueOf(request.balance()));
        account.setCreatedAt(LocalDateTime.now());
        accountMapper.insert(account);
        return new AccountResponse(account.getId(), account.getName(), account.getType(), account.getBalance(),
                List.of());
    }

    public AccountResponse updateAccount(Long userId, Long accountId, UpdateAccountRequest request) {
        AccountEntity account = findOwnedAccount(userId, accountId);
        accountMapper.update(accountId, request.name(), request.type());
        account.setName(request.name());
        account.setType(request.type());
        return toResponse(account);
    }

    public void deleteAccount(Long userId, Long accountId) {
        findOwnedAccount(userId, accountId);
        if (expenseMapper.countByAccountId(accountId) > 0) {
            throw new BadRequestException(IN_USE_MESSAGE);
        }
        accountMapper.delete(accountId);
    }

    public void validateOwnedAccountForExpense(Long userId, Long householdId, Long accountId) {
        AccountEntity account = accountMapper.findById(accountId);
        if (account == null || !account.getOwnerUserId().equals(userId)
                || !account.getHouseholdId().equals(householdId)) {
            throw new BadRequestException(INVALID_ACCOUNT_MESSAGE);
        }
    }

    @Transactional
    public void decrementBalance(Long accountId, BigDecimal amount) {
        AccountEntity account = accountMapper.lockById(accountId);
        accountMapper.updateBalance(accountId, account.getBalance().subtract(amount));
    }

    private AccountEntity findOwnedAccount(Long userId, Long accountId) {
        AccountEntity account = accountMapper.findById(accountId);
        if (account == null || !account.getOwnerUserId().equals(userId)) {
            throw new ResourceNotFoundException(NOT_FOUND_MESSAGE);
        }
        return account;
    }

    private Long resolveHouseholdId(Long userId) {
        var member = householdMemberMapper.findByUserId(userId);
        if (member == null) {
            throw new ResourceNotFoundException("世帯グループが見つかりません");
        }
        return member.getHouseholdId();
    }

    private AccountResponse toResponse(AccountEntity account) {
        List<CardResponse> cards = cardMapper.findByAccountId(account.getId()).stream()
                .map(card -> new CardResponse(card.getId(), card.getName(), card.getAccountId()))
                .toList();
        return new AccountResponse(account.getId(), account.getName(), account.getType(), account.getBalance(),
                cards);
    }
}

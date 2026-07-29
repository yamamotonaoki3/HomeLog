package com.homelog.kakeibo.controller;

import static com.homelog.common.security.CurrentUserProvider.currentUserId;

import com.homelog.kakeibo.dto.request.CreateAccountRequest;
import com.homelog.kakeibo.dto.request.UpdateAccountRequest;
import com.homelog.kakeibo.dto.response.AccountResponse;
import com.homelog.kakeibo.service.AccountService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/accounts")
public class AccountController {

    private final AccountService accountService;

    public AccountController(AccountService accountService) {
        this.accountService = accountService;
    }

    @GetMapping
    public List<AccountResponse> listAccounts() {
        return accountService.listAccounts(currentUserId());
    }

    @PostMapping
    public ResponseEntity<AccountResponse> createAccount(@Valid @RequestBody CreateAccountRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(accountService.createAccount(currentUserId(), request));
    }

    @PatchMapping("/{id}")
    public AccountResponse updateAccount(@PathVariable Long id, @Valid @RequestBody UpdateAccountRequest request) {
        return accountService.updateAccount(currentUserId(), id, request);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteAccount(@PathVariable Long id) {
        accountService.deleteAccount(currentUserId(), id);
        return ResponseEntity.noContent().build();
    }
}

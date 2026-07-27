package com.homelog.kakeibo.controller;

import static com.homelog.common.security.CurrentUserProvider.currentUserId;

import com.homelog.kakeibo.dto.request.CreateIncomeRequest;
import com.homelog.kakeibo.dto.response.IncomeResponse;
import com.homelog.kakeibo.service.IncomeService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/incomes")
public class IncomeController {

    private final IncomeService incomeService;

    public IncomeController(IncomeService incomeService) {
        this.incomeService = incomeService;
    }

    @GetMapping
    public List<IncomeResponse> listIncomes(@RequestParam(required = false) Long categoryId) {
        return incomeService.listIncomes(currentUserId(), categoryId);
    }

    @PostMapping
    public ResponseEntity<IncomeResponse> createIncome(@Valid @RequestBody CreateIncomeRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(incomeService.createIncome(currentUserId(), request));
    }
}

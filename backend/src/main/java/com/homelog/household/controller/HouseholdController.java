package com.homelog.household.controller;

import com.homelog.household.dto.request.CreateHouseholdRequest;
import com.homelog.household.dto.request.JoinHouseholdRequest;
import com.homelog.household.dto.response.HouseholdCreateResponse;
import com.homelog.household.dto.response.HouseholdJoinResponse;
import com.homelog.household.dto.response.HouseholdMeResponse;
import com.homelog.household.dto.response.InviteCodeResponse;
import com.homelog.household.service.HouseholdService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/households")
public class HouseholdController {

    private final HouseholdService householdService;

    public HouseholdController(HouseholdService householdService) {
        this.householdService = householdService;
    }

    @PostMapping
    public ResponseEntity<HouseholdCreateResponse> createHousehold(@Valid @RequestBody CreateHouseholdRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(householdService.createHousehold(currentUserId(), request));
    }

    @PostMapping("/join")
    public HouseholdJoinResponse joinHousehold(@Valid @RequestBody JoinHouseholdRequest request) {
        return householdService.joinHousehold(currentUserId(), request);
    }

    @GetMapping("/me")
    public HouseholdMeResponse getMyHousehold() {
        return householdService.getMyHousehold(currentUserId());
    }

    @PostMapping("/invite-code/regenerate")
    public InviteCodeResponse regenerateInviteCode() {
        return householdService.regenerateInviteCode(currentUserId());
    }

    // JwtAuthenticationFilterがSecurityContextHolderにユーザーIDを設定済みであることを前提とする
    private Long currentUserId() {
        return (Long) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
    }
}

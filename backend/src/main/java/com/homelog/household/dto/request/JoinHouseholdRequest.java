package com.homelog.household.dto.request;

import jakarta.validation.constraints.NotBlank;

public record JoinHouseholdRequest(@NotBlank String inviteCode) {
}

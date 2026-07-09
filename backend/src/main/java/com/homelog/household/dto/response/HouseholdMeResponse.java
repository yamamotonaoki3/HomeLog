package com.homelog.household.dto.response;

import java.util.List;

public record HouseholdMeResponse(Long id, String name, String inviteCode, List<MemberResponse> members) {
}

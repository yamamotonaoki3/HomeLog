package com.homelog.integration;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

/**
 * 主要フロー結合テスト：個人収入の登録・一覧取得（同一世帯内でも他人の収入は閲覧できないこと、
 * 世帯グループを跨いだ収入が混在しないこと）。
 */
class IncomeFlowIT extends IntegrationTestBase {

    private long firstCategoryId(String token) {
        List<Map<String, Object>> categories = getJsonList("/api/income-categories", token).getBody();
        assertThat(categories).isNotEmpty();
        return ((Number) categories.get(0).get("id")).longValue();
    }

    @Test
    @DisplayName("収入を登録すると一覧に反映され、同一世帯の他ユーザーの一覧には表示されない")
    void createIncomeIsVisibleOnlyToEarner() {
        String tokenA = registerAndLogin(uniqueEmail("income-a"));
        String inviteCode = createHousehold(tokenA, "収入テスト家");
        String tokenB = registerAndLogin(uniqueEmail("income-b"));
        postJson("/api/households/join", Map.of("inviteCode", inviteCode), tokenB);

        long categoryId = firstCategoryId(tokenA);
        ResponseEntity<Map<String, Object>> created = postJson("/api/incomes",
                Map.of("incomeDate", "2026-01-01", "amount", 250000, "content", "結合テスト用給与",
                        "categoryId", categoryId),
                tokenA);
        assertThat(created.getStatusCode().value()).isEqualTo(201);
        assertThat(created.getBody()).containsEntry("content", "結合テスト用給与");
        assertThat(created.getBody()).doesNotContainKey("includeInHouseholdTotal");

        List<Map<String, Object>> listA = getJsonList("/api/incomes", tokenA).getBody();
        assertThat(listA).hasSize(1);
        assertThat(listA.get(0)).containsEntry("content", "結合テスト用給与");

        // 同一世帯のBからは見えない（本人のみ閲覧可能）
        List<Map<String, Object>> listB = getJsonList("/api/incomes", tokenB).getBody();
        assertThat(listB).isEmpty();
    }

    @Test
    @DisplayName("カテゴリーで絞り込み検索できる")
    void filterIncomesByCategory() {
        String token = registerAndLogin(uniqueEmail("income-filter"));
        createHousehold(token, "絞り込みテスト家");
        List<Map<String, Object>> categories = getJsonList("/api/income-categories", token).getBody();
        long categoryId1 = ((Number) categories.get(0).get("id")).longValue();
        long categoryId2 = ((Number) categories.get(1).get("id")).longValue();

        postJson("/api/incomes",
                Map.of("incomeDate", "2026-01-01", "amount", 500, "content", "カテゴリー1の収入",
                        "categoryId", categoryId1),
                token);
        postJson("/api/incomes",
                Map.of("incomeDate", "2026-01-02", "amount", 800, "content", "カテゴリー2の収入",
                        "categoryId", categoryId2),
                token);

        List<Map<String, Object>> filtered =
                getJsonList("/api/incomes?categoryId=" + categoryId1, token).getBody();

        assertThat(filtered).hasSize(1);
        assertThat(filtered.get(0)).containsEntry("content", "カテゴリー1の収入");
    }

    @Test
    @DisplayName("世帯グループを退出して別世帯に参加すると、古い世帯の収入は一覧に出てこない")
    void incomesDoNotLeakAcrossHouseholdsAfterLeaveAndJoin() {
        String token = registerAndLogin(uniqueEmail("income-move"));
        createHousehold(token, "旧世帯");
        long oldCategoryId = firstCategoryId(token);
        postJson("/api/incomes",
                Map.of("incomeDate", "2026-01-01", "amount", 1000, "content", "旧世帯の収入",
                        "categoryId", oldCategoryId),
                token);

        ResponseEntity<Map<String, Object>> leaveResponse = postJson("/api/households/leave", null, token);
        assertThat(leaveResponse.getStatusCode().value()).isEqualTo(204);

        String tokenInviter = registerAndLogin(uniqueEmail("income-move-inviter"));
        String inviteCode = createHousehold(tokenInviter, "新世帯");
        postJson("/api/households/join", Map.of("inviteCode", inviteCode), token);

        List<Map<String, Object>> listAfterJoin = getJsonList("/api/incomes", token).getBody();
        assertThat(listAfterJoin).isEmpty();
    }

    @Test
    @DisplayName("収入・カテゴリーが存在する世帯でも最後の1人が退出すると世帯ごとCASCADE削除される")
    void leaveAsLastMemberDeletesHouseholdWithIncomeData() {
        String token = registerAndLogin(uniqueEmail("income-leave"));
        createHousehold(token, "収入退出テスト家");
        long categoryId = firstCategoryId(token);
        postJson("/api/incomes",
                Map.of("incomeDate", "2026-01-01", "amount", 1000, "content", "退出前の収入",
                        "categoryId", categoryId),
                token);

        ResponseEntity<Map<String, Object>> leaveResponse = postJson("/api/households/leave", null, token);

        assertThat(leaveResponse.getStatusCode().value()).isEqualTo(204);
        ResponseEntity<Map<String, Object>> meAfterLeave = getJson("/api/households/me", token);
        assertThat(meAfterLeave.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    @DisplayName("他世帯のカテゴリーを指定した収入登録は400を返す")
    void createIncomeWithOtherHouseholdCategoryReturns400() {
        String tokenOwner = registerAndLogin(uniqueEmail("income-owner"));
        createHousehold(tokenOwner, "自分の家");
        long ownCategoryId = firstCategoryId(tokenOwner);

        String tokenOther = registerAndLogin(uniqueEmail("income-other"));
        createHousehold(tokenOther, "他人の家");

        ResponseEntity<Map<String, Object>> response = postJson("/api/incomes",
                Map.of("incomeDate", "2026-01-01", "amount", 1000, "content", "不正な収入",
                        "categoryId", ownCategoryId),
                tokenOther);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
    }
}

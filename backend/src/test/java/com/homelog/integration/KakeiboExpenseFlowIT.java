package com.homelog.integration;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

/**
 * 主要フロー結合テスト：個人支出の登録・一覧取得（同一世帯内でも他人の支出は閲覧できないこと）。
 */
class KakeiboExpenseFlowIT extends IntegrationTestBase {

    private long firstCategoryId(String token) {
        List<Map<String, Object>> categories = getJsonList("/api/kakeibo-categories", token).getBody();
        assertThat(categories).isNotEmpty();
        return ((Number) categories.get(0).get("id")).longValue();
    }

    @Test
    @DisplayName("支出を登録すると一覧に反映され、同一世帯の他ユーザーの一覧には表示されない")
    void createExpenseIsVisibleOnlyToPayer() {
        String tokenA = registerAndLogin(uniqueEmail("expense-a"));
        String inviteCode = createHousehold(tokenA, "支出テスト家");
        String tokenB = registerAndLogin(uniqueEmail("expense-b"));
        postJson("/api/households/join", Map.of("inviteCode", inviteCode), tokenB);

        long categoryId = firstCategoryId(tokenA);
        ResponseEntity<Map<String, Object>> created = postJson("/api/expenses",
                Map.of("expenseDate", "2026-01-01", "amount", 1200, "purpose", "結合テスト用ランチ",
                        "categoryId", categoryId),
                tokenA);
        assertThat(created.getStatusCode().value()).isEqualTo(201);
        assertThat(created.getBody()).containsEntry("purpose", "結合テスト用ランチ");
        assertThat(created.getBody()).containsEntry("includeInHouseholdTotal", false);

        List<Map<String, Object>> listA = getJsonList("/api/expenses", tokenA).getBody();
        assertThat(listA).hasSize(1);
        assertThat(listA.get(0)).containsEntry("purpose", "結合テスト用ランチ");

        // 同一世帯のBからは見えない（本人のみ閲覧可能）
        List<Map<String, Object>> listB = getJsonList("/api/expenses", tokenB).getBody();
        assertThat(listB).isEmpty();
    }

    @Test
    @DisplayName("カテゴリーで絞り込み検索できる")
    void filterExpensesByCategory() {
        String token = registerAndLogin(uniqueEmail("expense-filter"));
        createHousehold(token, "絞り込みテスト家");
        List<Map<String, Object>> categories = getJsonList("/api/kakeibo-categories", token).getBody();
        long categoryId1 = ((Number) categories.get(0).get("id")).longValue();
        long categoryId2 = ((Number) categories.get(1).get("id")).longValue();

        postJson("/api/expenses",
                Map.of("expenseDate", "2026-01-01", "amount", 500, "purpose", "カテゴリー1の支出",
                        "categoryId", categoryId1),
                token);
        postJson("/api/expenses",
                Map.of("expenseDate", "2026-01-02", "amount", 800, "purpose", "カテゴリー2の支出",
                        "categoryId", categoryId2),
                token);

        List<Map<String, Object>> filtered =
                getJsonList("/api/expenses?categoryId=" + categoryId1, token).getBody();

        assertThat(filtered).hasSize(1);
        assertThat(filtered.get(0)).containsEntry("purpose", "カテゴリー1の支出");
    }

    @Test
    @DisplayName("支出・カテゴリーが存在する世帯でも最後の1人が退出すると世帯ごとCASCADE削除される")
    void leaveAsLastMemberDeletesHouseholdWithKakeiboData() {
        String token = registerAndLogin(uniqueEmail("kakeibo-leave"));
        createHousehold(token, "家計簿退出テスト家");
        long categoryId = firstCategoryId(token);
        postJson("/api/expenses",
                Map.of("expenseDate", "2026-01-01", "amount", 1000, "purpose", "退出前の支出",
                        "categoryId", categoryId),
                token);

        ResponseEntity<Map<String, Object>> leaveResponse = postJson("/api/households/leave", null, token);

        assertThat(leaveResponse.getStatusCode().value()).isEqualTo(204);
        ResponseEntity<Map<String, Object>> meAfterLeave = getJson("/api/households/me", token);
        assertThat(meAfterLeave.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    @DisplayName("他世帯のカテゴリーを指定した支出登録は400を返す")
    void createExpenseWithOtherHouseholdCategoryReturns400() {
        String tokenOwner = registerAndLogin(uniqueEmail("expense-owner"));
        createHousehold(tokenOwner, "自分の家");
        long ownCategoryId = firstCategoryId(tokenOwner);

        String tokenOther = registerAndLogin(uniqueEmail("expense-other"));
        createHousehold(tokenOther, "他人の家");

        ResponseEntity<Map<String, Object>> response = postJson("/api/expenses",
                Map.of("expenseDate", "2026-01-01", "amount", 1000, "purpose", "不正な支出",
                        "categoryId", ownCategoryId),
                tokenOther);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
    }
}

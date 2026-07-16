package com.homelog.integration;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

/**
 * 権限系結合テスト（IDOR対策）：他世帯のリソース指定で404、未認証で401が返ることを検証する。
 */
class AuthorizationIT extends IntegrationTestBase {

    /** 世帯所属済みユーザーを準備してトークンを返す。 */
    private String setupUserWithHousehold(String prefix) {
        String token = registerAndLogin(uniqueEmail(prefix));
        createHousehold(token, prefix + "の家");
        return token;
    }

    private long createInventoryItem(String token, String name) {
        List<Map<String, Object>> categories = getJsonList("/api/zaiko-categories", token).getBody();
        Number categoryId = (Number) categories.get(0).get("id");
        ResponseEntity<Map<String, Object>> created = postJson("/api/inventory-items",
                Map.of("name", name, "categoryId", categoryId, "quantity", 0.5, "threshold", 1.0), token);
        assertThat(created.getStatusCode().value()).isEqualTo(201);
        return ((Number) created.getBody().get("id")).longValue();
    }

    @Test
    @DisplayName("他世帯の在庫アイテムへの増減・更新・削除は404を返す")
    void otherHouseholdInventoryItemReturns404() {
        String tokenA = setupUserWithHousehold("idor-owner");
        long itemId = createInventoryItem(tokenA, "世帯Aの牛乳");
        String tokenB = setupUserWithHousehold("idor-attacker");

        ResponseEntity<Map<String, Object>> patchResponse =
                patchJson("/api/inventory-items/" + itemId + "/quantity", Map.of("delta", -0.1), tokenB);
        assertThat(patchResponse.getStatusCode().value()).isEqualTo(404);

        ResponseEntity<Map<String, Object>> deleteResponse =
                deleteJson("/api/inventory-items/" + itemId, tokenB);
        assertThat(deleteResponse.getStatusCode().value()).isEqualTo(404);

        // 世帯Bの一覧に世帯Aのアイテムが混ざらないこと
        List<Map<String, Object>> listB = getJsonList("/api/inventory-items", tokenB).getBody();
        assertThat(listB).isEmpty();
    }

    @Test
    @DisplayName("他世帯の買い物リスト項目の削除・購入反映は404を返す")
    void otherHouseholdShoppingListItemReturns404() {
        String tokenA = setupUserWithHousehold("idor-shop-owner");
        // 閾値未満（0.5 < 1.0）の在庫を登録し、買い物リストに自動追加させる
        createInventoryItem(tokenA, "世帯Aの卵");
        List<Map<String, Object>> listA = getJsonList("/api/shopping-list-items", tokenA).getBody();
        assertThat(listA).hasSize(1);
        Number shoppingItemId = (Number) listA.get(0).get("id");

        String tokenB = setupUserWithHousehold("idor-shop-attacker");

        ResponseEntity<Map<String, Object>> deleteResponse =
                deleteJson("/api/shopping-list-items/" + shoppingItemId, tokenB);
        assertThat(deleteResponse.getStatusCode().value()).isEqualTo(404);

        ResponseEntity<Map<String, Object>> updateResponse = postJson("/api/shopping-list-items/update",
                Map.of("items", List.of(Map.of("id", shoppingItemId, "purchasedQuantity", 1.0))), tokenB);
        assertThat(updateResponse.getStatusCode().value()).isEqualTo(404);

        // 世帯A側の項目は影響を受けず残っていること
        assertThat(getJsonList("/api/shopping-list-items", tokenA).getBody()).hasSize(1);
    }

    @Test
    @DisplayName("未認証（トークンなし）でのAPI呼び出しは401を返す")
    void unauthenticatedRequestsReturn401() {
        assertThat(getJson("/api/households/me", null).getStatusCode().value()).isEqualTo(401);
        assertThat(getJson("/api/inventory-items", null).getStatusCode().value()).isEqualTo(401);
        assertThat(getJson("/api/shopping-list-items", null).getStatusCode().value()).isEqualTo(401);
        assertThat(getJson("/api/dashboard/summary", null).getStatusCode().value()).isEqualTo(401);
    }
}

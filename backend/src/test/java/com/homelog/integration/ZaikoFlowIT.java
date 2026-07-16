package com.homelog.integration;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

/**
 * 主要フロー結合テスト：在庫登録→閾値下回りで買い物リスト自動追加→購入反映で在庫増加。
 */
class ZaikoFlowIT extends IntegrationTestBase {

    /** 世帯所属済みユーザーを準備してトークンを返す。 */
    private String setupUserWithHousehold(String prefix) {
        String token = registerAndLogin(uniqueEmail(prefix));
        createHousehold(token, prefix + "の家");
        return token;
    }

    private long createInventoryItem(String token, String name, double quantity, double threshold) {
        // Flywayが投入するデフォルトカテゴリーの先頭を使用する
        List<Map<String, Object>> categoryList = getJsonList("/api/zaiko-categories", token).getBody();
        assertThat(categoryList).isNotEmpty();
        Number categoryId = (Number) categoryList.get(0).get("id");

        ResponseEntity<Map<String, Object>> created = postJson("/api/inventory-items",
                Map.of("name", name, "categoryId", categoryId, "quantity", quantity, "threshold", threshold), token);
        assertThat(created.getStatusCode().value()).isEqualTo(201);
        return ((Number) created.getBody().get("id")).longValue();
    }

    @Test
    @DisplayName("在庫が閾値を下回ると買い物リストに自動追加され、購入反映で在庫が増えリストから除外される")
    void inventoryThresholdAutoAddAndPurchaseFlow() {
        String token = setupUserWithHousehold("zaiko-flow");
        long itemId = createInventoryItem(token, "牛乳", 2.0, 1.0);

        // 2.0 → 1.0（閾値ちょうど）：自動追加されない（境界値）
        ResponseEntity<Map<String, Object>> adjusted1 =
                patchJson("/api/inventory-items/" + itemId + "/quantity", Map.of("delta", -1.0), token);
        assertThat(adjusted1.getStatusCode().value()).isEqualTo(200);
        List<Map<String, Object>> listAtThreshold = getJsonList("/api/shopping-list-items", token).getBody();
        assertThat(listAtThreshold).isEmpty();

        // 1.0 → 0.5（閾値未満）：自動追加される
        patchJson("/api/inventory-items/" + itemId + "/quantity", Map.of("delta", -0.5), token);
        List<Map<String, Object>> listBelowThreshold = getJsonList("/api/shopping-list-items", token).getBody();
        assertThat(listBelowThreshold).hasSize(1);
        Map<String, Object> entry = listBelowThreshold.get(0);
        assertThat(entry).containsEntry("name", "牛乳").containsEntry("isManual", false);
        Number shoppingItemId = (Number) entry.get("id");

        // ダッシュボードのサマリーにも反映される
        ResponseEntity<Map<String, Object>> summary = getJson("/api/dashboard/summary", token);
        assertThat(summary.getStatusCode().value()).isEqualTo(200);
        assertThat(summary.getBody()).containsEntry("shoppingListCount", 1).containsEntry("lowStockCount", 1);

        // 購入反映（2個購入）：在庫0.5+2.0=2.5となり閾値超えでリストから除外
        ResponseEntity<Map<String, Object>> updated = postJson("/api/shopping-list-items/update",
                Map.of("items", List.of(Map.of("id", shoppingItemId, "purchasedQuantity", 2.0))), token);
        assertThat(updated.getStatusCode().value()).isEqualTo(200);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> updatedItems =
                (List<Map<String, Object>>) updated.getBody().get("updatedInventoryItems");
        assertThat(updatedItems).hasSize(1);
        assertThat(Double.parseDouble(String.valueOf(updatedItems.get(0).get("quantity")))).isEqualTo(2.5);

        List<Map<String, Object>> listAfterPurchase = getJsonList("/api/shopping-list-items", token).getBody();
        assertThat(listAfterPurchase).isEmpty();

        ResponseEntity<Map<String, Object>> summaryAfter = getJson("/api/dashboard/summary", token);
        assertThat(summaryAfter.getBody()).containsEntry("shoppingListCount", 0).containsEntry("lowStockCount", 0);
    }

    @Test
    @DisplayName("手動追加した品目は削除でき、店舗のその場登録も反映される")
    void manualAddDeleteAndStoreRegistration() {
        String token = setupUserWithHousehold("zaiko-manual");

        // 店舗のその場登録
        ResponseEntity<Map<String, Object>> store = postJson("/api/stores", Map.of("name", "スーパー結合"), token);
        assertThat(store.getStatusCode().value()).isEqualTo(201);
        assertThat(store.getBody()).containsEntry("name", "スーパー結合");

        long itemId = createInventoryItem(token, "卵", 5.0, 1.0);

        // 手動追加
        ResponseEntity<Map<String, Object>> added =
                postJson("/api/shopping-list-items", Map.of("inventoryItemId", itemId), token);
        assertThat(added.getStatusCode().value()).isEqualTo(201);
        assertThat(added.getBody()).containsEntry("isManual", true);
        Number shoppingItemId = (Number) added.getBody().get("id");

        // 削除
        ResponseEntity<Map<String, Object>> deleted =
                deleteJson("/api/shopping-list-items/" + shoppingItemId, token);
        assertThat(deleted.getStatusCode().value()).isEqualTo(204);
        assertThat(getJsonList("/api/shopping-list-items", token).getBody()).isEmpty();
    }
}

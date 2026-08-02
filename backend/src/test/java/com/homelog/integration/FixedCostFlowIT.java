package com.homelog.integration;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

/**
 * 主要フロー結合テスト：固定費の登録・一覧・編集・削除（世帯共有/個人所有の可視性、編集・削除は登録者のみ）。
 */
class FixedCostFlowIT extends IntegrationTestBase {

    @Test
    @DisplayName("世帯共有の固定費は世帯メンバー全員が閲覧できるが、編集・削除は登録者のみ可能")
    void sharedFixedCostIsVisibleToAllButEditableByCreatorOnly() {
        String tokenA = registerAndLogin(uniqueEmail("fixedcost-a"));
        String inviteCode = createHousehold(tokenA, "固定費テスト家");
        String tokenB = registerAndLogin(uniqueEmail("fixedcost-b"));
        postJson("/api/households/join", Map.of("inviteCode", inviteCode), tokenB);

        ResponseEntity<Map<String, Object>> created = postJson("/api/fixed-costs",
                Map.of("name", "家賃", "amount", 80000, "paymentDay", 27, "personal", false,
                        "includeInHouseholdTotal", true),
                tokenA);
        assertThat(created.getStatusCode().value()).isEqualTo(201);
        long fixedCostId = ((Number) created.getBody().get("id")).longValue();

        List<Map<String, Object>> listA = getJsonList("/api/fixed-costs", tokenA).getBody();
        List<Map<String, Object>> listB = getJsonList("/api/fixed-costs", tokenB).getBody();
        assertThat(listA).hasSize(1);
        assertThat(listB).hasSize(1);
        assertThat(listA.get(0)).containsEntry("editable", true);
        assertThat(listB.get(0)).containsEntry("editable", false);

        ResponseEntity<Map<String, Object>> updateByB = patchJson("/api/fixed-costs/" + fixedCostId,
                Map.of("name", "不正な変更", "amount", 1, "paymentDay", 1, "personal", false,
                        "includeInHouseholdTotal", false),
                tokenB);
        assertThat(updateByB.getStatusCode().value()).isEqualTo(404);

        ResponseEntity<Map<String, Object>> deleteByB = deleteJson("/api/fixed-costs/" + fixedCostId, tokenB);
        assertThat(deleteByB.getStatusCode().value()).isEqualTo(404);

        ResponseEntity<Map<String, Object>> updateByA = patchJson("/api/fixed-costs/" + fixedCostId,
                Map.of("name", "家賃（更新）", "amount", 85000, "paymentDay", 28, "personal", false,
                        "includeInHouseholdTotal", true),
                tokenA);
        assertThat(updateByA.getStatusCode().value()).isEqualTo(200);
        assertThat(updateByA.getBody()).containsEntry("name", "家賃（更新）");
    }

    @Test
    @DisplayName("個人所有の固定費は本人以外に一切表示されない")
    void personalFixedCostIsVisibleToOwnerOnly() {
        String tokenOwner = registerAndLogin(uniqueEmail("fixedcost-owner"));
        String inviteCode = createHousehold(tokenOwner, "個人固定費テスト家");
        String tokenOther = registerAndLogin(uniqueEmail("fixedcost-other"));
        postJson("/api/households/join", Map.of("inviteCode", inviteCode), tokenOther);

        postJson("/api/fixed-costs",
                Map.of("name", "個人サブスク", "amount", 1000, "paymentDay", 10, "personal", true,
                        "includeInHouseholdTotal", false),
                tokenOwner);

        List<Map<String, Object>> listOwner = getJsonList("/api/fixed-costs", tokenOwner).getBody();
        List<Map<String, Object>> listOther = getJsonList("/api/fixed-costs", tokenOther).getBody();
        assertThat(listOwner).hasSize(1);
        assertThat(listOther).isEmpty();
    }

    @Test
    @DisplayName("固定費を削除すると一覧から消える")
    void deleteFixedCostRemovesFromList() {
        String token = registerAndLogin(uniqueEmail("fixedcost-delete"));
        createHousehold(token, "削除テスト家");
        ResponseEntity<Map<String, Object>> created = postJson("/api/fixed-costs",
                Map.of("name", "水道代", "amount", 3000, "paymentDay", 15, "personal", false,
                        "includeInHouseholdTotal", false),
                token);
        long fixedCostId = ((Number) created.getBody().get("id")).longValue();

        ResponseEntity<Map<String, Object>> deleteResponse = deleteJson("/api/fixed-costs/" + fixedCostId, token);
        assertThat(deleteResponse.getStatusCode().value()).isEqualTo(204);

        List<Map<String, Object>> listAfterDelete = getJsonList("/api/fixed-costs", token).getBody();
        assertThat(listAfterDelete).isEmpty();
    }

    @Test
    @DisplayName("引き落とし元に口座を指定して登録・編集でき、他人の口座を指定すると400")
    void registersFixedCostWithAccountAndRejectsOthersAccount() {
        String tokenA = registerAndLogin(uniqueEmail("fixedcost-account-a"));
        String inviteCode = createHousehold(tokenA, "引き落とし元テスト家");
        String tokenB = registerAndLogin(uniqueEmail("fixedcost-account-b"));
        postJson("/api/households/join", Map.of("inviteCode", inviteCode), tokenB);
        ResponseEntity<Map<String, Object>> accountResponseA = postJson("/api/accounts",
                Map.of("name", "Aの口座", "type", "bank", "balance", 10000), tokenA);
        long accountIdA = ((Number) accountResponseA.getBody().get("id")).longValue();

        ResponseEntity<Map<String, Object>> created = postJson("/api/fixed-costs",
                Map.of("name", "家賃", "amount", 80000, "paymentDay", 27, "personal", false,
                        "includeInHouseholdTotal", true, "accountId", accountIdA),
                tokenA);
        assertThat(created.getStatusCode().value()).isEqualTo(201);
        assertThat(((Number) created.getBody().get("accountId")).longValue()).isEqualTo(accountIdA);

        ResponseEntity<Map<String, Object>> createdByOthersAccount = postJson("/api/fixed-costs",
                Map.of("name", "不正な固定費", "amount", 1000, "paymentDay", 1, "personal", false,
                        "includeInHouseholdTotal", false, "accountId", accountIdA),
                tokenB);
        assertThat(createdByOthersAccount.getStatusCode().value()).isEqualTo(400);
    }

    @Test
    @DisplayName("引き落とし元に口座とカードを同時に指定すると400")
    void rejectsFixedCostWithBothAccountAndCard() {
        String token = registerAndLogin(uniqueEmail("fixedcost-both"));
        createHousehold(token, "口座カード同時指定テスト家");
        ResponseEntity<Map<String, Object>> accountResponse = postJson("/api/accounts",
                Map.of("name", "口座", "type", "bank", "balance", 10000), token);
        long accountId = ((Number) accountResponse.getBody().get("id")).longValue();
        ResponseEntity<Map<String, Object>> cardResponse = postJson("/api/cards",
                Map.of("accountId", accountId, "name", "カード", "cardType", "credit"), token);
        long cardId = ((Number) cardResponse.getBody().get("id")).longValue();

        ResponseEntity<Map<String, Object>> created = postJson("/api/fixed-costs",
                Map.of("name", "家賃", "amount", 80000, "paymentDay", 27, "personal", false,
                        "includeInHouseholdTotal", true, "accountId", accountId, "cardId", cardId),
                token);

        assertThat(created.getStatusCode().value()).isEqualTo(400);
    }
}

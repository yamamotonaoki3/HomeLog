package com.homelog.integration;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

/**
 * 主要フロー結合テスト：口座・カードの登録・残高自動減算（同一世帯内でも他人の口座は閲覧できないこと）。
 */
class AccountFlowIT extends IntegrationTestBase {

    private long firstExpenseCategoryId(String token) {
        List<Map<String, Object>> categories = getJsonList("/api/kakeibo-categories", token).getBody();
        assertThat(categories).isNotEmpty();
        return ((Number) categories.get(0).get("id")).longValue();
    }

    @Test
    @DisplayName("口座を登録すると一覧に反映され、同一世帯の他ユーザーの一覧には表示されない")
    void createAccountIsVisibleOnlyToOwner() {
        String tokenA = registerAndLogin(uniqueEmail("account-a"));
        String inviteCode = createHousehold(tokenA, "口座テスト家");
        String tokenB = registerAndLogin(uniqueEmail("account-b"));
        postJson("/api/households/join", Map.of("inviteCode", inviteCode), tokenB);

        ResponseEntity<Map<String, Object>> created = postJson("/api/accounts",
                Map.of("name", "結合テスト銀行", "type", "bank", "balance", 10000),
                tokenA);
        assertThat(created.getStatusCode().value()).isEqualTo(201);
        assertThat(created.getBody()).containsEntry("name", "結合テスト銀行");

        List<Map<String, Object>> listA = getJsonList("/api/accounts", tokenA).getBody();
        assertThat(listA).hasSize(1);

        List<Map<String, Object>> listB = getJsonList("/api/accounts", tokenB).getBody();
        assertThat(listB).isEmpty();
    }

    @Test
    @DisplayName("世帯グループを退出して別世帯に参加すると、古い世帯の口座は一覧に出てこない")
    void accountsDoNotLeakAcrossHouseholdsAfterLeaveAndJoin() {
        String token = registerAndLogin(uniqueEmail("account-move"));
        createHousehold(token, "旧世帯");
        postJson("/api/accounts", Map.of("name", "旧世帯の口座", "type", "bank", "balance", 1000), token);

        ResponseEntity<Map<String, Object>> leaveResponse = postJson("/api/households/leave", null, token);
        assertThat(leaveResponse.getStatusCode().value()).isEqualTo(204);

        String tokenInviter = registerAndLogin(uniqueEmail("account-move-inviter"));
        String inviteCode = createHousehold(tokenInviter, "新世帯");
        postJson("/api/households/join", Map.of("inviteCode", inviteCode), token);

        List<Map<String, Object>> listAfterJoin = getJsonList("/api/accounts", token).getBody();
        assertThat(listAfterJoin).isEmpty();
    }

    @Test
    @DisplayName("口座を指定して支出を登録すると、口座の残高が支出金額分だけ減算される")
    void createExpenseWithAccountDecrementsBalance() {
        String token = registerAndLogin(uniqueEmail("account-expense"));
        createHousehold(token, "残高減算テスト家");
        long categoryId = firstExpenseCategoryId(token);
        ResponseEntity<Map<String, Object>> accountResponse = postJson("/api/accounts",
                Map.of("name", "生活費口座", "type", "bank", "balance", 10000), token);
        long accountId = ((Number) accountResponse.getBody().get("id")).longValue();

        ResponseEntity<Map<String, Object>> expenseResponse = postJson("/api/expenses",
                Map.of("expenseDate", "2026-01-01", "amount", 3000, "purpose", "口座指定の支出",
                        "categoryId", categoryId, "accountId", accountId),
                token);
        assertThat(expenseResponse.getStatusCode().value()).isEqualTo(201);
        assertThat(((Number) expenseResponse.getBody().get("accountId")).longValue()).isEqualTo(accountId);

        List<Map<String, Object>> accounts = getJsonList("/api/accounts", token).getBody();
        assertThat(accounts).hasSize(1);
        assertThat(((Number) accounts.get(0).get("balance")).intValue()).isEqualTo(7000);
    }

    @Test
    @DisplayName("世帯を退出後、退出前の世帯に残った口座を更新・削除しようとすると404を返す")
    void mutatingAccountFromFormerHouseholdReturns404() {
        String token = registerAndLogin(uniqueEmail("account-former-house"));
        String inviteCode = createHousehold(token, "退出前の世帯");
        ResponseEntity<Map<String, Object>> accountResponse = postJson("/api/accounts",
                Map.of("name", "退出前の世帯の口座", "type", "bank", "balance", 1000), token);
        long accountId = ((Number) accountResponse.getBody().get("id")).longValue();

        String tokenOtherMember = registerAndLogin(uniqueEmail("account-former-house-member"));
        postJson("/api/households/join", Map.of("inviteCode", inviteCode), tokenOtherMember);
        ResponseEntity<Map<String, Object>> leaveResponse = postJson("/api/households/leave", null, token);
        assertThat(leaveResponse.getStatusCode().value()).isEqualTo(204);

        String tokenInviter = registerAndLogin(uniqueEmail("account-former-house-inviter"));
        String newInviteCode = createHousehold(tokenInviter, "新しい世帯");
        postJson("/api/households/join", Map.of("inviteCode", newInviteCode), token);

        ResponseEntity<Map<String, Object>> updateResponse = patchJson("/api/accounts/" + accountId,
                Map.of("name", "不正な更新", "type", "bank"), token);
        assertThat(updateResponse.getStatusCode().value()).isEqualTo(404);

        ResponseEntity<Map<String, Object>> deleteResponse = deleteJson("/api/accounts/" + accountId, token);
        assertThat(deleteResponse.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    @DisplayName("カードを指定して支出を登録すると、親口座の残高が支出金額分だけ減算される")
    void createExpenseWithCardDecrementsParentAccountBalance() {
        String token = registerAndLogin(uniqueEmail("account-card-expense"));
        createHousehold(token, "カード残高減算テスト家");
        long categoryId = firstExpenseCategoryId(token);
        ResponseEntity<Map<String, Object>> accountResponse = postJson("/api/accounts",
                Map.of("name", "カード紐付き口座", "type", "bank", "balance", 10000), token);
        long accountId = ((Number) accountResponse.getBody().get("id")).longValue();
        ResponseEntity<Map<String, Object>> cardResponse = postJson("/api/cards",
                Map.of("accountId", accountId, "name", "生活費カード"), token);
        long cardId = ((Number) cardResponse.getBody().get("id")).longValue();

        ResponseEntity<Map<String, Object>> expenseResponse = postJson("/api/expenses",
                Map.of("expenseDate", "2026-01-01", "amount", 3000, "purpose", "カード指定の支出",
                        "categoryId", categoryId, "cardId", cardId),
                token);
        assertThat(expenseResponse.getStatusCode().value()).isEqualTo(201);
        assertThat(((Number) expenseResponse.getBody().get("accountId")).longValue()).isEqualTo(accountId);

        List<Map<String, Object>> accounts = getJsonList("/api/accounts", token).getBody();
        assertThat(((Number) accounts.get(0).get("balance")).intValue()).isEqualTo(7000);
    }

    @Test
    @DisplayName("口座とカードを同時に指定した支出登録は400を返す")
    void createExpenseWithBothAccountAndCardReturns400() {
        String token = registerAndLogin(uniqueEmail("account-card-both"));
        createHousehold(token, "口座カード同時指定テスト家");
        long categoryId = firstExpenseCategoryId(token);
        ResponseEntity<Map<String, Object>> accountResponse = postJson("/api/accounts",
                Map.of("name", "口座", "type", "bank", "balance", 10000), token);
        long accountId = ((Number) accountResponse.getBody().get("id")).longValue();
        ResponseEntity<Map<String, Object>> cardResponse = postJson("/api/cards",
                Map.of("accountId", accountId, "name", "カード"), token);
        long cardId = ((Number) cardResponse.getBody().get("id")).longValue();

        ResponseEntity<Map<String, Object>> response = postJson("/api/expenses",
                Map.of("expenseDate", "2026-01-01", "amount", 1000, "purpose", "同時指定エラー",
                        "categoryId", categoryId, "accountId", accountId, "cardId", cardId),
                token);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
    }

    @Test
    @DisplayName("他人の口座を指定した支出登録は400を返す")
    void createExpenseWithOtherUsersAccountReturns400() {
        String tokenOwner = registerAndLogin(uniqueEmail("account-owner"));
        String inviteCode = createHousehold(tokenOwner, "自分の家");
        ResponseEntity<Map<String, Object>> accountResponse = postJson("/api/accounts",
                Map.of("name", "所有者口座", "type", "bank", "balance", 10000), tokenOwner);
        long accountId = ((Number) accountResponse.getBody().get("id")).longValue();

        String tokenOther = registerAndLogin(uniqueEmail("account-other"));
        postJson("/api/households/join", Map.of("inviteCode", inviteCode), tokenOther);
        long categoryId = firstExpenseCategoryId(tokenOther);

        ResponseEntity<Map<String, Object>> response = postJson("/api/expenses",
                Map.of("expenseDate", "2026-01-01", "amount", 1000, "purpose", "不正な口座指定",
                        "categoryId", categoryId, "accountId", accountId),
                tokenOther);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
    }

    @Test
    @DisplayName("使用中の口座は削除できず400を返す")
    void deleteAccountInUseReturns400() {
        String token = registerAndLogin(uniqueEmail("account-inuse"));
        createHousehold(token, "使用中削除テスト家");
        long categoryId = firstExpenseCategoryId(token);
        ResponseEntity<Map<String, Object>> accountResponse = postJson("/api/accounts",
                Map.of("name", "使用中口座", "type", "bank", "balance", 10000), token);
        long accountId = ((Number) accountResponse.getBody().get("id")).longValue();
        postJson("/api/expenses",
                Map.of("expenseDate", "2026-01-01", "amount", 1000, "purpose", "口座使用中の支出",
                        "categoryId", categoryId, "accountId", accountId),
                token);

        ResponseEntity<Map<String, Object>> deleteResponse = deleteJson("/api/accounts/" + accountId, token);

        assertThat(deleteResponse.getStatusCode().value()).isEqualTo(400);
    }

    @Test
    @DisplayName("口座・カードが存在する世帯でも最後の1人が退出すると世帯ごとCASCADE削除される")
    void leaveAsLastMemberDeletesHouseholdWithAccountData() {
        String token = registerAndLogin(uniqueEmail("account-leave"));
        createHousehold(token, "口座退出テスト家");
        ResponseEntity<Map<String, Object>> accountResponse = postJson("/api/accounts",
                Map.of("name", "退出前の口座", "type", "bank", "balance", 5000), token);
        long accountId = ((Number) accountResponse.getBody().get("id")).longValue();
        postJson("/api/cards", Map.of("accountId", accountId, "name", "退出前のカード"), token);

        ResponseEntity<Map<String, Object>> leaveResponse = postJson("/api/households/leave", null, token);

        assertThat(leaveResponse.getStatusCode().value()).isEqualTo(204);
        ResponseEntity<Map<String, Object>> meAfterLeave = getJson("/api/households/me", token);
        assertThat(meAfterLeave.getStatusCode().value()).isEqualTo(404);
    }
}

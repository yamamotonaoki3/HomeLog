package com.homelog.integration;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

/**
 * 主要フロー結合テスト：世帯グループ退出（複数人在籍時は世帯存続、最後の1人退出時は世帯・在庫・買い物リストがCASCADE削除される）。
 */
class HouseholdLeaveFlowIT extends IntegrationTestBase {

    @Test
    @DisplayName("複数人が所属する世帯で1人が退出しても世帯グループとデータは存続する")
    void leaveWithOtherMembersRemainingKeepsHousehold() {
        String token1 = registerAndLogin(uniqueEmail("leave-remain-1"));
        String inviteCode = createHousehold(token1, "退出テスト家1");
        String token2 = registerAndLogin(uniqueEmail("leave-remain-2"));
        postJson("/api/households/join", Map.of("inviteCode", inviteCode), token2);

        ResponseEntity<Map<String, Object>> leaveResponse = postJson("/api/households/leave", null, token1);
        assertThat(leaveResponse.getStatusCode().value()).isEqualTo(204);

        // 退出したユーザーは未所属になる
        ResponseEntity<Map<String, Object>> meAfterLeave = getJson("/api/households/me", token1);
        assertThat(meAfterLeave.getStatusCode().value()).isEqualTo(404);

        // 残ったユーザーからは世帯が存続し、メンバーが1名になっていることが見える
        ResponseEntity<Map<String, Object>> meRemaining = getJson("/api/households/me", token2);
        assertThat(meRemaining.getStatusCode().value()).isEqualTo(200);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> members = (List<Map<String, Object>>) meRemaining.getBody().get("members");
        assertThat(members).hasSize(1);
    }

    @Test
    @DisplayName("最後の1人が退出すると世帯グループと在庫・買い物リストがCASCADE削除される")
    void leaveAsLastMemberDeletesHouseholdAndZaikoData() {
        String token = registerAndLogin(uniqueEmail("leave-last"));
        createHousehold(token, "退出テスト家2");

        List<Map<String, Object>> categoryList = getJsonList("/api/zaiko-categories", token).getBody();
        Number categoryId = (Number) categoryList.get(0).get("id");
        ResponseEntity<Map<String, Object>> item = postJson("/api/inventory-items",
                Map.of("name", "退出テスト在庫", "categoryId", categoryId, "quantity", 0.0, "threshold", 1.0), token);
        assertThat(item.getStatusCode().value()).isEqualTo(201);
        assertThat(getJsonList("/api/shopping-list-items", token).getBody()).hasSize(1);

        ResponseEntity<Map<String, Object>> leaveResponse = postJson("/api/households/leave", null, token);
        assertThat(leaveResponse.getStatusCode().value()).isEqualTo(204);

        // 世帯グループが削除され、未所属になっている
        ResponseEntity<Map<String, Object>> meAfterLeave = getJson("/api/households/me", token);
        assertThat(meAfterLeave.getStatusCode().value()).isEqualTo(404);

        // 退出後は同じユーザーで新しい世帯グループを作成できる（household_membersのUNIQUE制約が正しく解放されている）
        ResponseEntity<Map<String, Object>> recreate =
                postJson("/api/households", Map.of("name", "退出後の新しい家"), token);
        assertThat(recreate.getStatusCode().value()).isEqualTo(201);
    }

    @Test
    @DisplayName("未所属ユーザーの退出は404を返す")
    void leaveWithoutHouseholdReturns404() {
        String token = registerAndLogin(uniqueEmail("leave-no-household"));

        ResponseEntity<Map<String, Object>> response = postJson("/api/households/leave", null, token);

        assertThat(response.getStatusCode().value()).isEqualTo(404);
    }
}

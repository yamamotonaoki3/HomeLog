package com.homelog.integration;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

/**
 * 主要フロー結合テスト：ユーザー登録→ログイン→世帯作成→（別ユーザーで）招待コード参加。
 */
class AuthHouseholdFlowIT extends IntegrationTestBase {

    @Test
    @DisplayName("登録→ログイン→世帯作成→別ユーザーが招待コードで参加し、両者が同一世帯のメンバーになる")
    void registerLoginCreateHouseholdAndJoin() {
        // ユーザー1：登録→ログイン→世帯作成
        String email1 = uniqueEmail("taro");
        ResponseEntity<Map<String, Object>> registerResponse = postJson("/api/auth/register",
                Map.of("email", email1, "password", "Passw0rd1", "displayName", "太郎"), null);
        assertThat(registerResponse.getStatusCode().value()).isEqualTo(201);
        assertThat(registerResponse.getBody()).containsEntry("email", email1).containsEntry("displayName", "太郎");

        String token1 = login(email1, "Passw0rd1");
        assertThat(token1).isNotBlank();

        ResponseEntity<Map<String, Object>> createResponse =
                postJson("/api/households", Map.of("name", "結合テスト家"), token1);
        assertThat(createResponse.getStatusCode().value()).isEqualTo(201);
        String inviteCode = (String) createResponse.getBody().get("inviteCode");
        assertThat(inviteCode).isNotBlank();

        // ユーザー2：登録→ログイン→招待コードで参加
        String email2 = uniqueEmail("hanako");
        String token2 = registerAndLogin(email2);
        ResponseEntity<Map<String, Object>> joinResponse =
                postJson("/api/households/join", Map.of("inviteCode", inviteCode), token2);
        assertThat(joinResponse.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(joinResponse.getBody()).containsEntry("name", "結合テスト家");

        // 両者のGET /households/meが同一世帯・メンバー2名を返す
        ResponseEntity<Map<String, Object>> me1 = getJson("/api/households/me", token1);
        ResponseEntity<Map<String, Object>> me2 = getJson("/api/households/me", token2);
        assertThat(me1.getStatusCode().value()).isEqualTo(200);
        assertThat(me2.getStatusCode().value()).isEqualTo(200);
        assertThat(me1.getBody().get("id")).isEqualTo(me2.getBody().get("id"));
        assertThat(me1.getBody()).containsEntry("name", "結合テスト家");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> members = (List<Map<String, Object>>) me1.getBody().get("members");
        assertThat(members).hasSize(2);
        assertThat(members).extracting(m -> m.get("displayName")).containsExactlyInAnyOrder("太郎", "結合テストユーザー");
    }

    @Test
    @DisplayName("無効な招待コードでの参加は404を返す（コード誤りと期限切れを区別しない）")
    void joinWithInvalidInviteCodeReturns404() {
        String token = registerAndLogin(uniqueEmail("invalid-code"));

        ResponseEntity<Map<String, Object>> response =
                postJson("/api/households/join", Map.of("inviteCode", "INVALIDCODE00000"), token);

        assertThat(response.getStatusCode().value()).isEqualTo(404);
        assertThat(response.getBody()).containsEntry("message", "招待コードが無効です");
    }

    @Test
    @DisplayName("登録済みメールアドレスでの登録は409を返す")
    void registerWithDuplicateEmailReturns409() {
        String email = uniqueEmail("dup");
        register(email, "Passw0rd1", "先客");

        ResponseEntity<Map<String, Object>> response = postJson("/api/auth/register",
                Map.of("email", email, "password", "Passw0rd1", "displayName", "後客"), null);

        assertThat(response.getStatusCode().value()).isEqualTo(409);
    }

    @Test
    @DisplayName("誤ったパスワードでのログインは401を返す")
    void loginWithWrongPasswordReturns401() {
        String email = uniqueEmail("wrong-pass");
        register(email, "Passw0rd1", "本人");

        ResponseEntity<Map<String, Object>> response =
                postJson("/api/auth/login", Map.of("email", email, "password", "WrongPass9"), null);

        assertThat(response.getStatusCode().value()).isEqualTo(401);
    }

    @Test
    @DisplayName("既に世帯に所属しているユーザーの世帯作成は400を返す")
    void createHouseholdWhenAlreadyInHouseholdReturns400() {
        String token = registerAndLogin(uniqueEmail("already"));
        createHousehold(token, "一つ目の家");

        ResponseEntity<Map<String, Object>> response = postJson("/api/households", Map.of("name", "二つ目の家"), token);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
    }
}

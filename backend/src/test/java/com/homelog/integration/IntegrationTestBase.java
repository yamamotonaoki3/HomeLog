package com.homelog.integration;

import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * API結合テストの基盤クラス。
 * Testcontainersで起動したPostgreSQL 17に対し、実HTTP（TestRestTemplate）で
 * Controller→Service→Mapper→DBを通しで検証する。
 * コンテナはstaticシングルトンとして全結合テストで共有し、起動コストを1回に抑える。
 * テスト間のデータ独立は、テストごとに一意のメールアドレス・世帯を作成することで担保する。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureTestRestTemplate
@Tag("integration")
public abstract class IntegrationTestBase {

    @ServiceConnection
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17");

    static {
        POSTGRES.start();
    }

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    @Autowired
    protected TestRestTemplate restTemplate;

    /** JWT署名鍵はapplication.ymlのローカル既定値に依存せずテスト用に固定する。 */
    @DynamicPropertySource
    static void overrideProperties(DynamicPropertyRegistry registry) {
        registry.add("jwt.secret", () -> "integration-test-secret-key-at-least-32-chars");
    }

    /** テストごとに一意なメールアドレスを生成する。 */
    protected String uniqueEmail(String prefix) {
        return prefix + "-" + System.nanoTime() + "-" + SEQUENCE.incrementAndGet() + "@example.com";
    }

    /** ユーザーを登録する（201を検証）。 */
    protected void register(String email, String password, String displayName) {
        ResponseEntity<Map<String, Object>> response = postJson("/api/auth/register",
                Map.of("email", email, "password", password, "displayName", displayName), null);
        if (response.getStatusCode().value() != 201) {
            throw new IllegalStateException("ユーザー登録に失敗しました: " + response.getStatusCode());
        }
    }

    /** ログインしてアクセストークンを返す（200を検証）。 */
    protected String login(String email, String password) {
        ResponseEntity<Map<String, Object>> response = postJson("/api/auth/login",
                Map.of("email", email, "password", password), null);
        if (response.getStatusCode().value() != 200) {
            throw new IllegalStateException("ログインに失敗しました: " + response.getStatusCode());
        }
        return (String) response.getBody().get("accessToken");
    }

    /** ユーザー登録＋ログインを行い、アクセストークンを返す。 */
    protected String registerAndLogin(String email) {
        register(email, "Passw0rd1", "結合テストユーザー");
        return login(email, "Passw0rd1");
    }

    /** 世帯グループを作成し、招待コードを返す（201を検証）。 */
    protected String createHousehold(String token, String name) {
        ResponseEntity<Map<String, Object>> response = postJson("/api/households", Map.of("name", name), token);
        if (response.getStatusCode().value() != 201) {
            throw new IllegalStateException("世帯グループ作成に失敗しました: " + response.getStatusCode());
        }
        return (String) response.getBody().get("inviteCode");
    }

    /** 認証ヘッダー付きでGETする。 */
    protected ResponseEntity<Map<String, Object>> getJson(String path, String token) {
        return exchange(path, HttpMethod.GET, null, token);
    }

    /** 認証ヘッダー付きでPOSTする（tokenがnullなら未認証）。 */
    protected ResponseEntity<Map<String, Object>> postJson(String path, Object body, String token) {
        return exchange(path, HttpMethod.POST, body, token);
    }

    /** 認証ヘッダー付きでPATCHする。 */
    protected ResponseEntity<Map<String, Object>> patchJson(String path, Object body, String token) {
        return exchange(path, HttpMethod.PATCH, body, token);
    }

    /** 認証ヘッダー付きでDELETEする。 */
    protected ResponseEntity<Map<String, Object>> deleteJson(String path, String token) {
        return exchange(path, HttpMethod.DELETE, null, token);
    }

    /** 認証ヘッダー付きでリスト形式のレスポンスをGETする。 */
    protected ResponseEntity<java.util.List<Map<String, Object>>> getJsonList(String path, String token) {
        return restTemplate.exchange(path, HttpMethod.GET, new HttpEntity<>(null, headers(token)),
                new org.springframework.core.ParameterizedTypeReference<>() {
                });
    }

    private ResponseEntity<Map<String, Object>> exchange(String path, HttpMethod method, Object body, String token) {
        return restTemplate.exchange(path, method, new HttpEntity<>(body, headers(token)),
                new org.springframework.core.ParameterizedTypeReference<>() {
                });
    }

    private HttpHeaders headers(String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (token != null) {
            headers.setBearerAuth(token);
        }
        return headers;
    }
}

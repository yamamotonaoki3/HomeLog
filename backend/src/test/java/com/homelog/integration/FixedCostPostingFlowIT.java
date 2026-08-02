package com.homelog.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.homelog.kakeibo.service.FixedCostPostingService;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 固定費の自動計上バッチ（{@link FixedCostPostingService}）の結合テスト。
 * 支払日一致・月末クランプ・二重計上防止をAPI経由で検証する。
 */
class FixedCostPostingFlowIT extends IntegrationTestBase {

    @Autowired
    private FixedCostPostingService fixedCostPostingService;

    @Test
    @DisplayName("カテゴリー一覧を未取得の世帯でも固定費が自動計上される")
    void postsFixedCostBeforeCategoriesAreInitialized() {
        String token = registerAndLogin(uniqueEmail("posting-without-categories"));
        createHousehold(token, "カテゴリー未初期化テスト家");
        LocalDate today = LocalDate.of(2026, 3, 27);
        postJson("/api/fixed-costs",
                Map.of("name", "家賃", "amount", 80000, "paymentDay", today.getDayOfMonth(), "personal", false,
                        "includeInHouseholdTotal", true),
                token);

        fixedCostPostingService.postForDate(today);

        List<Map<String, Object>> expenses = getJsonList("/api/expenses", token).getBody();
        assertThat(expenses).hasSize(1);
        assertThat(expenses.get(0)).containsEntry("purpose", "家賃");
    }

    @Test
    @DisplayName("支払日が当日と一致する固定費は自動計上され、同日に再実行しても重複計上されない")
    void postsFixedCostOnPaymentDayAndPreventsDuplicatePosting() {
        String token = registerAndLogin(uniqueEmail("posting-a"));
        createHousehold(token, "自動計上テスト家");
        getJsonList("/api/kakeibo-categories", token);

        LocalDate today = LocalDate.of(2026, 3, 27);
        postJson("/api/fixed-costs",
                Map.of("name", "家賃", "amount", 80000, "paymentDay", today.getDayOfMonth(), "personal", false,
                        "includeInHouseholdTotal", true),
                token);

        fixedCostPostingService.postForDate(today);
        fixedCostPostingService.postForDate(today);

        List<Map<String, Object>> expenses = getJsonList("/api/expenses", token).getBody();
        assertThat(expenses).hasSize(1);
        assertThat(expenses.get(0)).containsEntry("purpose", "家賃");
        assertThat(((Number) expenses.get(0).get("amount")).intValue()).isEqualTo(80000);
    }

    @Test
    @DisplayName("同名のカスタムカテゴリーがあってもデフォルトの固定費カテゴリーで自動計上される")
    void postsWithDefaultCategoryWhenCustomCategoryHasSameName() {
        String token = registerAndLogin(uniqueEmail("posting-custom-category"));
        createHousehold(token, "同名カテゴリーテスト家");
        postJson("/api/kakeibo-categories", Map.of("name", "固定費"), token);
        List<Map<String, Object>> categories = getJsonList("/api/kakeibo-categories", token).getBody();
        Long defaultCategoryId = categories.stream()
                .filter(category -> "固定費".equals(category.get("name")))
                .filter(category -> Boolean.TRUE.equals(category.get("isDefault")))
                .map(category -> ((Number) category.get("id")).longValue())
                .findFirst()
                .orElseThrow();
        LocalDate today = LocalDate.of(2026, 3, 27);
        postJson("/api/fixed-costs",
                Map.of("name", "家賃", "amount", 80000, "paymentDay", today.getDayOfMonth(), "personal", false,
                        "includeInHouseholdTotal", true),
                token);

        fixedCostPostingService.postForDate(today);

        List<Map<String, Object>> expenses = getJsonList("/api/expenses", token).getBody();
        assertThat(expenses).hasSize(1);
        assertThat(((Number) expenses.get(0).get("categoryId")).longValue()).isEqualTo(defaultCategoryId);
    }

    @Test
    @DisplayName("支払日が当月に存在しない固定費は月末にクランプして計上される")
    void postsFixedCostOnLastDayOfMonthWhenPaymentDayDoesNotExist() {
        String token = registerAndLogin(uniqueEmail("posting-b"));
        createHousehold(token, "月末クランプテスト家");
        getJsonList("/api/kakeibo-categories", token);

        postJson("/api/fixed-costs",
                Map.of("name", "31日払いの固定費", "amount", 5000, "paymentDay", 31, "personal", false,
                        "includeInHouseholdTotal", false),
                token);

        LocalDate lastDayOfFebruary = LocalDate.of(2026, 2, 28);
        fixedCostPostingService.postForDate(lastDayOfFebruary);

        List<Map<String, Object>> expenses = getJsonList("/api/expenses", token).getBody();
        assertThat(expenses).hasSize(1);
        assertThat(expenses.get(0)).containsEntry("purpose", "31日払いの固定費");
        assertThat(expenses.get(0)).containsEntry("expenseDate", "2026-02-28");
    }

    @Test
    @DisplayName("支払日が一致しない固定費は計上されない")
    void doesNotPostFixedCostWhenPaymentDayDoesNotMatch() {
        String token = registerAndLogin(uniqueEmail("posting-c"));
        createHousehold(token, "支払日不一致テスト家");
        getJsonList("/api/kakeibo-categories", token);

        postJson("/api/fixed-costs",
                Map.of("name", "15日払いの固定費", "amount", 3000, "paymentDay", 15, "personal", false,
                        "includeInHouseholdTotal", false),
                token);

        fixedCostPostingService.postForDate(LocalDate.of(2026, 3, 27));

        List<Map<String, Object>> expenses = getJsonList("/api/expenses", token).getBody();
        assertThat(expenses).isEmpty();
    }
}

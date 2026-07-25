package com.homelog.kakeibo.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.homelog.common.exception.BadRequestException;
import com.homelog.common.security.JwtUtil;
import com.homelog.kakeibo.dto.request.CreateExpenseRequest;
import com.homelog.kakeibo.dto.response.ExpenseResponse;
import com.homelog.kakeibo.service.ExpenseService;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Answers;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(ExpenseController.class)
@AutoConfigureMockMvc(addFilters = false)
class ExpenseControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());

    @MockitoBean
    private ExpenseService expenseService;

    @MockitoBean
    private JwtUtil jwtUtil;

    @MockitoBean(answers = Answers.RETURNS_DEEP_STUBS)
    private SqlSessionFactory sqlSessionFactory;

    @BeforeEach
    void setUpAuthentication() {
        SecurityContextHolder.getContext()
                .setAuthentication(new UsernamePasswordAuthenticationToken(1L, null, List.of()));
    }

    @AfterEach
    void clearAuthentication() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void listExpenses_正常系は200() throws Exception {
        when(expenseService.listExpenses(anyLong(), any()))
                .thenReturn(List.of(new ExpenseResponse(1L, LocalDate.of(2026, 1, 1),
                        new BigDecimal("1000"), "ランチ", 5L, null, false)));

        mockMvc.perform(get("/api/expenses"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].purpose").value("ランチ"));
    }

    @Test
    void createExpense_正常系は201() throws Exception {
        when(expenseService.createExpense(anyLong(), any()))
                .thenReturn(new ExpenseResponse(1L, LocalDate.of(2026, 1, 1),
                        new BigDecimal("1000"), "ランチ", 5L, null, false));

        CreateExpenseRequest request = new CreateExpenseRequest(
                LocalDate.of(2026, 1, 1), 1000L, "ランチ", 5L, null, null);

        mockMvc.perform(post("/api/expenses")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.purpose").value("ランチ"));
    }

    @Test
    void createExpense_他世帯カテゴリー指定は400() throws Exception {
        when(expenseService.createExpense(anyLong(), any()))
                .thenThrow(new BadRequestException("指定されたカテゴリーが見つかりません"));

        CreateExpenseRequest request = new CreateExpenseRequest(
                LocalDate.of(2026, 1, 1), 1000L, "ランチ", 5L, null, null);

        mockMvc.perform(post("/api/expenses")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void createExpense_金額0以下は400() throws Exception {
        CreateExpenseRequest request = new CreateExpenseRequest(
                LocalDate.of(2026, 1, 1), 0L, "ランチ", 5L, null, null);

        mockMvc.perform(post("/api/expenses")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void createExpense_使用用途が空は400() throws Exception {
        CreateExpenseRequest request = new CreateExpenseRequest(
                LocalDate.of(2026, 1, 1), 1000L, "", 5L, null, null);

        mockMvc.perform(post("/api/expenses")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }
}

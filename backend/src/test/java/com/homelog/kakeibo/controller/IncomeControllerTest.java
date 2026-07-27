package com.homelog.kakeibo.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.homelog.common.exception.BadRequestException;
import com.homelog.common.security.JwtUtil;
import com.homelog.kakeibo.dto.request.CreateIncomeRequest;
import com.homelog.kakeibo.dto.response.IncomeResponse;
import com.homelog.kakeibo.service.IncomeService;
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

@WebMvcTest(IncomeController.class)
@AutoConfigureMockMvc(addFilters = false)
class IncomeControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());

    @MockitoBean
    private IncomeService incomeService;

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
    void listIncomes_正常系は200() throws Exception {
        when(incomeService.listIncomes(anyLong(), any()))
                .thenReturn(List.of(new IncomeResponse(1L, LocalDate.of(2026, 1, 1),
                        new BigDecimal("1000"), "給与", 5L, null)));

        mockMvc.perform(get("/api/incomes"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].content").value("給与"));
    }

    @Test
    void createIncome_正常系は201() throws Exception {
        when(incomeService.createIncome(anyLong(), any()))
                .thenReturn(new IncomeResponse(1L, LocalDate.of(2026, 1, 1),
                        new BigDecimal("1000"), "給与", 5L, null));

        CreateIncomeRequest request = new CreateIncomeRequest(
                LocalDate.of(2026, 1, 1), 1000L, "給与", 5L, null);

        mockMvc.perform(post("/api/incomes")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.content").value("給与"));
    }

    @Test
    void createIncome_他世帯カテゴリー指定は400() throws Exception {
        when(incomeService.createIncome(anyLong(), any()))
                .thenThrow(new BadRequestException("指定されたカテゴリーが見つかりません"));

        CreateIncomeRequest request = new CreateIncomeRequest(
                LocalDate.of(2026, 1, 1), 1000L, "給与", 5L, null);

        mockMvc.perform(post("/api/incomes")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void createIncome_金額0以下は400() throws Exception {
        CreateIncomeRequest request = new CreateIncomeRequest(
                LocalDate.of(2026, 1, 1), 0L, "給与", 5L, null);

        mockMvc.perform(post("/api/incomes")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void createIncome_金額上限超過は400() throws Exception {
        CreateIncomeRequest request = new CreateIncomeRequest(
                LocalDate.of(2026, 1, 1), 10_000_000_000L, "給与", 5L, null);

        mockMvc.perform(post("/api/incomes")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());

        verify(incomeService, never()).createIncome(anyLong(), any());
    }

    @Test
    void createIncome_内容が空は400() throws Exception {
        CreateIncomeRequest request = new CreateIncomeRequest(
                LocalDate.of(2026, 1, 1), 1000L, "", 5L, null);

        mockMvc.perform(post("/api/incomes")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }
}

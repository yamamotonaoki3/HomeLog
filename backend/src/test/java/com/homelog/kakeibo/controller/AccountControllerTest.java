package com.homelog.kakeibo.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homelog.common.exception.BadRequestException;
import com.homelog.common.security.JwtUtil;
import com.homelog.kakeibo.dto.request.CreateAccountRequest;
import com.homelog.kakeibo.dto.request.UpdateAccountRequest;
import com.homelog.kakeibo.dto.response.AccountResponse;
import com.homelog.kakeibo.service.AccountService;
import java.math.BigDecimal;
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

@WebMvcTest(AccountController.class)
@AutoConfigureMockMvc(addFilters = false)
class AccountControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @MockitoBean
    private AccountService accountService;

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
    void listAccounts_正常系は200() throws Exception {
        when(accountService.listAccounts(anyLong()))
                .thenReturn(List.of(new AccountResponse(1L, "〇〇銀行", "bank", new BigDecimal("10000"), List.of())));

        mockMvc.perform(get("/api/accounts"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("〇〇銀行"));
    }

    @Test
    void createAccount_正常系は201() throws Exception {
        when(accountService.createAccount(anyLong(), any()))
                .thenReturn(new AccountResponse(1L, "PayPay", "e_money", new BigDecimal("3000"), List.of()));

        mockMvc.perform(post("/api/accounts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateAccountRequest("PayPay", "e_money", 3000L))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("PayPay"));
    }

    @Test
    void updateAccount_他人の口座は404扱いのため呼び出し元は正常系のみ検証() throws Exception {
        when(accountService.updateAccount(anyLong(), anyLong(), any()))
                .thenReturn(new AccountResponse(1L, "新名義", "bank", new BigDecimal("10000"), List.of()));

        mockMvc.perform(patch("/api/accounts/1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new UpdateAccountRequest("新名義", "bank"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("新名義"));
    }

    @Test
    void deleteAccount_正常系は204() throws Exception {
        mockMvc.perform(delete("/api/accounts/1"))
                .andExpect(status().isNoContent());
    }

    @Test
    void deleteAccount_使用中は400() throws Exception {
        org.mockito.Mockito.doThrow(new BadRequestException("使用中の口座は削除できません"))
                .when(accountService).deleteAccount(anyLong(), anyLong());

        mockMvc.perform(delete("/api/accounts/1"))
                .andExpect(status().isBadRequest());
    }
}

package com.homelog.kakeibo.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homelog.common.exception.BadRequestException;
import com.homelog.common.security.JwtUtil;
import com.homelog.kakeibo.dto.request.ChargeCardRequest;
import com.homelog.kakeibo.dto.request.CreateCardRequest;
import com.homelog.kakeibo.dto.request.UpdateCardRequest;
import com.homelog.kakeibo.dto.response.CardResponse;
import com.homelog.kakeibo.dto.response.ChargeResponse;
import com.homelog.kakeibo.service.CardService;
import java.math.BigDecimal;
import java.time.LocalDateTime;
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

@WebMvcTest(CardController.class)
@AutoConfigureMockMvc(addFilters = false)
class CardControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @MockitoBean
    private CardService cardService;

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
    void createCard_cardType省略時も201() throws Exception {
        when(cardService.createCard(anyLong(), any()))
                .thenReturn(new CardResponse(1L, "〇〇カード", 5L, "credit", BigDecimal.ZERO));

        mockMvc.perform(post("/api/cards")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":5,\"name\":\"〇〇カード\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("〇〇カード"));
    }

    @Test
    void createCard_他人の口座指定は400() throws Exception {
        when(cardService.createCard(anyLong(), any()))
                .thenThrow(new BadRequestException("指定された口座が見つかりません"));

        mockMvc.perform(post("/api/cards")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateCardRequest(5L, "〇〇カード", "credit"))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void updateCard_正常系は200() throws Exception {
        when(cardService.updateCard(anyLong(), anyLong(), any()))
                .thenReturn(new CardResponse(1L, "新カード名", 5L, "credit", BigDecimal.ZERO));

        mockMvc.perform(patch("/api/cards/1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new UpdateCardRequest("新カード名"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("新カード名"));
    }

    @Test
    void deleteCard_正常系は204() throws Exception {
        mockMvc.perform(delete("/api/cards/1"))
                .andExpect(status().isNoContent());
    }

    @Test
    void chargeCard_正常系は200() throws Exception {
        when(cardService.chargeCard(anyLong(), anyLong(), any()))
                .thenReturn(new ChargeResponse(1L, 1L, 5L, new BigDecimal("3000"), new BigDecimal("3000"),
                        new BigDecimal("7000"), LocalDateTime.now()));

        mockMvc.perform(post("/api/cards/1/charges")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ChargeCardRequest(5L, 3000L))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cardBalanceAfter").value(3000))
                .andExpect(jsonPath("$.accountBalanceAfter").value(7000));
    }

    @Test
    void chargeCard_credit型カードへのチャージは400() throws Exception {
        when(cardService.chargeCard(anyLong(), anyLong(), any()))
                .thenThrow(new BadRequestException("チャージ型カードではありません"));

        mockMvc.perform(post("/api/cards/1/charges")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ChargeCardRequest(5L, 3000L))))
                .andExpect(status().isBadRequest());
    }
}

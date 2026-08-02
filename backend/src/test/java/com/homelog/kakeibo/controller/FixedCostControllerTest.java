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
import com.homelog.common.security.JwtUtil;
import com.homelog.kakeibo.dto.request.CreateFixedCostRequest;
import com.homelog.kakeibo.dto.request.UpdateFixedCostRequest;
import com.homelog.kakeibo.dto.response.FixedCostResponse;
import com.homelog.kakeibo.service.FixedCostService;
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

@WebMvcTest(FixedCostController.class)
@AutoConfigureMockMvc(addFilters = false)
class FixedCostControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @MockitoBean
    private FixedCostService fixedCostService;

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
    void listFixedCosts_正常系は200() throws Exception {
        when(fixedCostService.listFixedCosts(anyLong()))
                .thenReturn(List.of(
                        new FixedCostResponse(1L, "家賃", new BigDecimal("80000"), 27, false, true, true, null, null)));

        mockMvc.perform(get("/api/fixed-costs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("家賃"));
    }

    @Test
    void createFixedCost_正常系は201() throws Exception {
        when(fixedCostService.createFixedCost(anyLong(), any()))
                .thenReturn(new FixedCostResponse(1L, "家賃", new BigDecimal("80000"), 27, false, true, true, null,
                        null));

        mockMvc.perform(post("/api/fixed-costs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new CreateFixedCostRequest("家賃", 80000L, 27, false, true, null, null))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("家賃"));
    }

    @Test
    void updateFixedCost_正常系は200() throws Exception {
        when(fixedCostService.updateFixedCost(anyLong(), anyLong(), any()))
                .thenReturn(new FixedCostResponse(1L, "新家賃", new BigDecimal("90000"), 28, false, true, true, null,
                        null));

        mockMvc.perform(patch("/api/fixed-costs/1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new UpdateFixedCostRequest("新家賃", 90000L, 28, false, true, null, null))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("新家賃"));
    }

    @Test
    void deleteFixedCost_正常系は204() throws Exception {
        mockMvc.perform(delete("/api/fixed-costs/1"))
                .andExpect(status().isNoContent());
    }
}

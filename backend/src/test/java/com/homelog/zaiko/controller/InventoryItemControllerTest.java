package com.homelog.zaiko.controller;

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
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.common.security.JwtUtil;
import com.homelog.zaiko.dto.request.CreateInventoryItemRequest;
import com.homelog.zaiko.dto.request.QuantityAdjustRequest;
import com.homelog.zaiko.dto.request.UpdateInventoryItemRequest;
import com.homelog.zaiko.dto.response.InventoryItemResponse;
import com.homelog.zaiko.dto.response.QuantityResponse;
import com.homelog.zaiko.service.InventoryItemService;
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

@WebMvcTest(InventoryItemController.class)
@AutoConfigureMockMvc(addFilters = false)
class InventoryItemControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @MockitoBean
    private InventoryItemService inventoryItemService;

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
    void listItems_正常系は200() throws Exception {
        when(inventoryItemService.listItems(anyLong())).thenReturn(
                List.of(new InventoryItemResponse(1L, "牛乳", 3L, null, new BigDecimal("1.0"), new BigDecimal("0.5"))));

        mockMvc.perform(get("/api/inventory-items"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("牛乳"));
    }

    @Test
    void createItem_正常系は201() throws Exception {
        when(inventoryItemService.createItem(anyLong(), any())).thenReturn(
                new InventoryItemResponse(1L, "牛乳", 3L, null, new BigDecimal("1.0"), new BigDecimal("0.5")));

        mockMvc.perform(post("/api/inventory-items")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new CreateInventoryItemRequest("牛乳", 3L, null,
                                        new BigDecimal("1.0"), new BigDecimal("0.5")))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("牛乳"));
    }

    @Test
    void createItem_数量が小数点第二位以下の場合は400() throws Exception {
        mockMvc.perform(post("/api/inventory-items")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new CreateInventoryItemRequest("牛乳", 3L, null,
                                        new BigDecimal("1.05"), new BigDecimal("0.5")))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void updateItem_正常系は200() throws Exception {
        when(inventoryItemService.updateItem(anyLong(), anyLong(), any())).thenReturn(
                new InventoryItemResponse(1L, "牛乳(改)", 3L, null, new BigDecimal("1.0"), new BigDecimal("0.8")));

        mockMvc.perform(patch("/api/inventory-items/1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new UpdateInventoryItemRequest("牛乳(改)", 3L, null, new BigDecimal("0.8")))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("牛乳(改)"));
    }

    @Test
    void adjustQuantity_正常系は200() throws Exception {
        when(inventoryItemService.adjustQuantity(anyLong(), anyLong(), any()))
                .thenReturn(new QuantityResponse(1L, new BigDecimal("0.9")));

        mockMvc.perform(patch("/api/inventory-items/1/quantity")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new QuantityAdjustRequest(new BigDecimal("-0.1")))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.quantity").value(0.9));
    }

    @Test
    void adjustQuantity_増減量が小数点第二位以下の場合は400() throws Exception {
        mockMvc.perform(patch("/api/inventory-items/1/quantity")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new QuantityAdjustRequest(new BigDecimal("0.05")))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void adjustQuantity_0未満は400() throws Exception {
        when(inventoryItemService.adjustQuantity(anyLong(), anyLong(), any()))
                .thenThrow(new BadRequestException("在庫個数は0未満にできません"));

        mockMvc.perform(patch("/api/inventory-items/1/quantity")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new QuantityAdjustRequest(new BigDecimal("-10.0")))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void updateItem_他世帯のアイテムは404() throws Exception {
        when(inventoryItemService.updateItem(anyLong(), anyLong(), any()))
                .thenThrow(new ResourceNotFoundException("在庫アイテムが見つかりません"));

        mockMvc.perform(patch("/api/inventory-items/999")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new UpdateInventoryItemRequest("牛乳(改)", 3L, null, new BigDecimal("0.8")))))
                .andExpect(status().isNotFound());
    }

    @Test
    void deleteItem_正常系は204() throws Exception {
        mockMvc.perform(delete("/api/inventory-items/1"))
                .andExpect(status().isNoContent());
    }
}

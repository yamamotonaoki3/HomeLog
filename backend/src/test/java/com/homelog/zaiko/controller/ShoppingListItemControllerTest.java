package com.homelog.zaiko.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.common.security.JwtUtil;
import com.homelog.zaiko.dto.request.CreateShoppingListItemRequest;
import com.homelog.zaiko.dto.request.ProcessPurchaseRequest;
import com.homelog.zaiko.dto.request.PurchaseLineRequest;
import com.homelog.zaiko.dto.response.ProcessPurchaseResponse;
import com.homelog.zaiko.dto.response.QuantityResponse;
import com.homelog.zaiko.dto.response.ShoppingListItemResponse;
import com.homelog.zaiko.service.ShoppingListItemService;
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

@WebMvcTest(ShoppingListItemController.class)
@AutoConfigureMockMvc(addFilters = false)
class ShoppingListItemControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @MockitoBean
    private ShoppingListItemService shoppingListItemService;

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
        when(shoppingListItemService.listItems(anyLong(), any())).thenReturn(
                List.of(new ShoppingListItemResponse(1L, 100L, "牛乳", false, false, BigDecimal.ZERO)));

        mockMvc.perform(get("/api/shopping-list-items"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("牛乳"));
    }

    @Test
    void listItems_sortパラメータを渡せる() throws Exception {
        when(shoppingListItemService.listItems(anyLong(), anyString())).thenReturn(List.of());

        mockMvc.perform(get("/api/shopping-list-items").param("sort", "category"))
                .andExpect(status().isOk());
    }

    @Test
    void createManualItem_正常系は201() throws Exception {
        when(shoppingListItemService.createManualItem(anyLong(), any())).thenReturn(
                new ShoppingListItemResponse(1L, 100L, "牛乳", true, false, BigDecimal.ZERO));

        mockMvc.perform(post("/api/shopping-list-items")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateShoppingListItemRequest(100L))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.isManual").value(true));
    }

    @Test
    void createManualItem_既に追加済みは400() throws Exception {
        when(shoppingListItemService.createManualItem(anyLong(), any()))
                .thenThrow(new BadRequestException("既に買い物リストに追加されています"));

        mockMvc.perform(post("/api/shopping-list-items")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateShoppingListItemRequest(100L))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void deleteItem_正常系は204() throws Exception {
        mockMvc.perform(delete("/api/shopping-list-items/1"))
                .andExpect(status().isNoContent());
    }

    @Test
    void deleteItem_他世帯の品目は404() throws Exception {
        org.mockito.Mockito.doThrow(new ResourceNotFoundException("買い物リスト品目が見つかりません"))
                .when(shoppingListItemService).deleteItem(anyLong(), anyLong());

        mockMvc.perform(delete("/api/shopping-list-items/1"))
                .andExpect(status().isNotFound());
    }

    @Test
    void processPurchase_正常系は200() throws Exception {
        when(shoppingListItemService.processPurchase(anyLong(), any())).thenReturn(
                new ProcessPurchaseResponse(List.of(new QuantityResponse(100L, new BigDecimal("1.0"))),
                        List.of(1L)));

        ProcessPurchaseRequest request = new ProcessPurchaseRequest(
                List.of(new PurchaseLineRequest(1L, new BigDecimal("1.0"))));
        mockMvc.perform(post("/api/shopping-list-items/update")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.removedShoppingListItemIds[0]").value(1))
                .andExpect(jsonPath("$.updatedInventoryItems[0].quantity").value(1.0));
    }

    @Test
    void processPurchase_空リストは400() throws Exception {
        mockMvc.perform(post("/api/shopping-list-items/update")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ProcessPurchaseRequest(List.of()))))
                .andExpect(status().isBadRequest());
    }
}

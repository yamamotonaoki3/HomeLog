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
import com.homelog.common.security.JwtUtil;
import com.homelog.zaiko.dto.request.CreateStoreRequest;
import com.homelog.zaiko.dto.request.UpdateStoreRequest;
import com.homelog.zaiko.dto.response.StoreResponse;
import com.homelog.zaiko.service.StoreService;
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

@WebMvcTest(StoreController.class)
@AutoConfigureMockMvc(addFilters = false)
class StoreControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @MockitoBean
    private StoreService storeService;

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
    void listStores_正常系は200() throws Exception {
        when(storeService.listStores(anyLong())).thenReturn(List.of(new StoreResponse(1L, "スーパーA")));

        mockMvc.perform(get("/api/stores"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("スーパーA"));
    }

    @Test
    void createStore_正常系は201() throws Exception {
        when(storeService.createStore(anyLong(), any())).thenReturn(new StoreResponse(2L, "スーパーB"));

        mockMvc.perform(post("/api/stores")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateStoreRequest("スーパーB"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("スーパーB"));
    }

    @Test
    void updateStore_正常系は200() throws Exception {
        when(storeService.updateStore(anyLong(), anyLong(), any())).thenReturn(new StoreResponse(2L, "改名後"));

        mockMvc.perform(patch("/api/stores/2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new UpdateStoreRequest("改名後"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("改名後"));
    }

    @Test
    void deleteStore_使用中は400() throws Exception {
        org.mockito.Mockito.doThrow(new BadRequestException("使用中の店舗は削除できません"))
                .when(storeService).deleteStore(anyLong(), anyLong());

        mockMvc.perform(delete("/api/stores/2"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void deleteStore_正常系は204() throws Exception {
        mockMvc.perform(delete("/api/stores/2"))
                .andExpect(status().isNoContent());
    }
}

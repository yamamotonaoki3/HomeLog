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
import com.homelog.kakeibo.dto.request.CreateCategoryRequest;
import com.homelog.kakeibo.dto.request.UpdateCategoryRequest;
import com.homelog.kakeibo.dto.response.CategoryResponse;
import com.homelog.kakeibo.service.KakeiboCategoryService;
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

@WebMvcTest(KakeiboCategoryController.class)
@AutoConfigureMockMvc(addFilters = false)
class KakeiboCategoryControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @MockitoBean
    private KakeiboCategoryService kakeiboCategoryService;

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
    void listCategories_正常系は200() throws Exception {
        when(kakeiboCategoryService.listCategories(anyLong()))
                .thenReturn(List.of(new CategoryResponse(1L, "食費", true)));

        mockMvc.perform(get("/api/kakeibo-categories"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("食費"));
    }

    @Test
    void createCategory_正常系は201() throws Exception {
        when(kakeiboCategoryService.createCategory(anyLong(), any()))
                .thenReturn(new CategoryResponse(11L, "新カテゴリー", false));

        mockMvc.perform(post("/api/kakeibo-categories")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateCategoryRequest("新カテゴリー"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("新カテゴリー"));
    }

    @Test
    void updateCategory_デフォルトカテゴリーは400() throws Exception {
        when(kakeiboCategoryService.updateCategory(anyLong(), anyLong(), any()))
                .thenThrow(new BadRequestException("デフォルトカテゴリーは編集・削除できません"));

        mockMvc.perform(patch("/api/kakeibo-categories/1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new UpdateCategoryRequest("改名"))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void deleteCategory_正常系は204() throws Exception {
        mockMvc.perform(delete("/api/kakeibo-categories/1"))
                .andExpect(status().isNoContent());
    }

    @Test
    void deleteCategory_使用中は400() throws Exception {
        org.mockito.Mockito.doThrow(new BadRequestException("使用中のカテゴリーは削除できません"))
                .when(kakeiboCategoryService).deleteCategory(anyLong(), anyLong());

        mockMvc.perform(delete("/api/kakeibo-categories/1"))
                .andExpect(status().isBadRequest());
    }
}

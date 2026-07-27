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
import com.homelog.kakeibo.dto.request.CreateIncomeCategoryRequest;
import com.homelog.kakeibo.dto.request.UpdateIncomeCategoryRequest;
import com.homelog.kakeibo.dto.response.IncomeCategoryResponse;
import com.homelog.kakeibo.service.IncomeCategoryService;
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

@WebMvcTest(IncomeCategoryController.class)
@AutoConfigureMockMvc(addFilters = false)
class IncomeCategoryControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @MockitoBean
    private IncomeCategoryService incomeCategoryService;

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
        when(incomeCategoryService.listCategories(anyLong()))
                .thenReturn(List.of(new IncomeCategoryResponse(1L, "給与", true)));

        mockMvc.perform(get("/api/income-categories"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("給与"));
    }

    @Test
    void createCategory_正常系は201() throws Exception {
        when(incomeCategoryService.createCategory(anyLong(), any()))
                .thenReturn(new IncomeCategoryResponse(11L, "新カテゴリー", false));

        mockMvc.perform(post("/api/income-categories")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateIncomeCategoryRequest("新カテゴリー"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("新カテゴリー"));
    }

    @Test
    void updateCategory_デフォルトカテゴリーは400() throws Exception {
        when(incomeCategoryService.updateCategory(anyLong(), anyLong(), any()))
                .thenThrow(new BadRequestException("デフォルトカテゴリーは編集・削除できません"));

        mockMvc.perform(patch("/api/income-categories/1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new UpdateIncomeCategoryRequest("改名"))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void deleteCategory_正常系は204() throws Exception {
        mockMvc.perform(delete("/api/income-categories/1"))
                .andExpect(status().isNoContent());
    }

    @Test
    void deleteCategory_使用中は400() throws Exception {
        org.mockito.Mockito.doThrow(new BadRequestException("使用中のカテゴリーは削除できません"))
                .when(incomeCategoryService).deleteCategory(anyLong(), anyLong());

        mockMvc.perform(delete("/api/income-categories/1"))
                .andExpect(status().isBadRequest());
    }
}

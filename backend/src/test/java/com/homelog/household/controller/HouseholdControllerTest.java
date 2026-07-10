package com.homelog.household.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.common.security.JwtUtil;
import com.homelog.household.dto.request.CreateHouseholdRequest;
import com.homelog.household.dto.request.JoinHouseholdRequest;
import com.homelog.household.dto.response.HouseholdCreateResponse;
import com.homelog.household.dto.response.HouseholdJoinResponse;
import com.homelog.household.dto.response.HouseholdMeResponse;
import com.homelog.household.dto.response.InviteCodeResponse;
import com.homelog.household.dto.response.MemberResponse;
import com.homelog.household.service.HouseholdService;
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

@WebMvcTest(HouseholdController.class)
@AutoConfigureMockMvc(addFilters = false)
class HouseholdControllerTest {

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @MockitoBean
    private HouseholdService householdService;

    // JwtAuthenticationFilterがWebMvcTestのコンポーネントスキャン対象になるため、依存先をモックする
    @MockitoBean
    private JwtUtil jwtUtil;

    @MockitoBean(answers = Answers.RETURNS_DEEP_STUBS)
    private SqlSessionFactory sqlSessionFactory;

    @BeforeEach
    void setUpAuthentication() {
        // WebMvcTestスライスではSecurityConfigが読み込まれずフィルタも動かないため、
        // 実際のJwtAuthenticationFilterと同じ状態（SecurityContextHolderにユーザーIDを設定）を模倣する
        SecurityContextHolder.getContext()
                .setAuthentication(new UsernamePasswordAuthenticationToken(1L, null, List.of()));
    }

    @AfterEach
    void clearAuthentication() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void createHousehold_正常系は201() throws Exception {
        when(householdService.createHousehold(anyLong(), any()))
                .thenReturn(new HouseholdCreateResponse(10L, "山田家", "AB12CD34EF56GH78"));

        mockMvc.perform(post("/api/households")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateHouseholdRequest("山田家"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.inviteCode").value("AB12CD34EF56GH78"));
    }

    @Test
    void createHousehold_既に所属している場合は400() throws Exception {
        when(householdService.createHousehold(anyLong(), any()))
                .thenThrow(new BadRequestException("既に所属しています"));

        mockMvc.perform(post("/api/households")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CreateHouseholdRequest("山田家"))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void joinHousehold_正常系は200() throws Exception {
        when(householdService.joinHousehold(anyLong(), any()))
                .thenReturn(new HouseholdJoinResponse(10L, "山田家"));

        mockMvc.perform(post("/api/households/join")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinHouseholdRequest("AB12CD34EF56GH78"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("山田家"));
    }

    @Test
    void joinHousehold_招待コード不正は404() throws Exception {
        when(householdService.joinHousehold(anyLong(), any()))
                .thenThrow(new ResourceNotFoundException("招待コードが無効です"));

        mockMvc.perform(post("/api/households/join")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new JoinHouseholdRequest("UNKNOWN"))))
                .andExpect(status().isNotFound());
    }

    @Test
    void getMyHousehold_正常系は200() throws Exception {
        when(householdService.getMyHousehold(anyLong())).thenReturn(
                new HouseholdMeResponse(10L, "山田家", "AB12CD34EF56GH78",
                        List.of(new MemberResponse(1L, "太郎"))));

        mockMvc.perform(get("/api/households/me"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.members[0].displayName").value("太郎"));
    }

    @Test
    void getMyHousehold_未所属は404() throws Exception {
        when(householdService.getMyHousehold(anyLong())).thenThrow(new ResourceNotFoundException("未所属です"));

        mockMvc.perform(get("/api/households/me"))
                .andExpect(status().isNotFound());
    }

    @Test
    void regenerateInviteCode_正常系は200() throws Exception {
        when(householdService.regenerateInviteCode(anyLong()))
                .thenReturn(new InviteCodeResponse("ZZ99YY88XX77WW66"));

        mockMvc.perform(post("/api/households/invite-code/regenerate"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.inviteCode").value("ZZ99YY88XX77WW66"));
    }
}

package com.homelog.dashboard.controller;

import static com.homelog.common.security.CurrentUserProvider.currentUserId;

import com.homelog.dashboard.dto.response.DashboardSummaryResponse;
import com.homelog.dashboard.service.DashboardService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {

    private final DashboardService dashboardService;

    public DashboardController(DashboardService dashboardService) {
        this.dashboardService = dashboardService;
    }

    @GetMapping("/summary")
    public DashboardSummaryResponse getSummary() {
        return dashboardService.getSummary(currentUserId());
    }
}

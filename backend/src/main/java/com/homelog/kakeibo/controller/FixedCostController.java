package com.homelog.kakeibo.controller;

import static com.homelog.common.security.CurrentUserProvider.currentUserId;

import com.homelog.kakeibo.dto.request.CreateFixedCostRequest;
import com.homelog.kakeibo.dto.request.UpdateFixedCostRequest;
import com.homelog.kakeibo.dto.response.FixedCostResponse;
import com.homelog.kakeibo.service.FixedCostService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/fixed-costs")
public class FixedCostController {

    private final FixedCostService fixedCostService;

    public FixedCostController(FixedCostService fixedCostService) {
        this.fixedCostService = fixedCostService;
    }

    @GetMapping
    public List<FixedCostResponse> listFixedCosts() {
        return fixedCostService.listFixedCosts(currentUserId());
    }

    @PostMapping
    public ResponseEntity<FixedCostResponse> createFixedCost(@Valid @RequestBody CreateFixedCostRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(fixedCostService.createFixedCost(currentUserId(), request));
    }

    @PatchMapping("/{id}")
    public FixedCostResponse updateFixedCost(@PathVariable Long id,
            @Valid @RequestBody UpdateFixedCostRequest request) {
        return fixedCostService.updateFixedCost(currentUserId(), id, request);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteFixedCost(@PathVariable Long id) {
        fixedCostService.deleteFixedCost(currentUserId(), id);
        return ResponseEntity.noContent().build();
    }
}

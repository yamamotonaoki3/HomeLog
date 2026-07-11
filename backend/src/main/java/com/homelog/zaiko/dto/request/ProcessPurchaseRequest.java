package com.homelog.zaiko.dto.request;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;

public record ProcessPurchaseRequest(
        @NotEmpty @Valid List<PurchaseLineRequest> items) {
}

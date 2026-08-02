package com.homelog.kakeibo.entity;

import java.math.BigDecimal;
import java.time.LocalDateTime;

public class FixedCostEntity {

    private Long id;
    private Long householdId;
    private Long ownerUserId;
    private Long createdByUserId;
    private String name;
    private BigDecimal amount;
    private int paymentDay;
    private boolean includeInHouseholdTotal;
    private LocalDateTime createdAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getHouseholdId() {
        return householdId;
    }

    public void setHouseholdId(Long householdId) {
        this.householdId = householdId;
    }

    public Long getOwnerUserId() {
        return ownerUserId;
    }

    public void setOwnerUserId(Long ownerUserId) {
        this.ownerUserId = ownerUserId;
    }

    public Long getCreatedByUserId() {
        return createdByUserId;
    }

    public void setCreatedByUserId(Long createdByUserId) {
        this.createdByUserId = createdByUserId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public void setAmount(BigDecimal amount) {
        this.amount = amount;
    }

    public int getPaymentDay() {
        return paymentDay;
    }

    public void setPaymentDay(int paymentDay) {
        this.paymentDay = paymentDay;
    }

    public boolean isIncludeInHouseholdTotal() {
        return includeInHouseholdTotal;
    }

    public void setIncludeInHouseholdTotal(boolean includeInHouseholdTotal) {
        this.includeInHouseholdTotal = includeInHouseholdTotal;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }
}

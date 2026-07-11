package com.homelog.zaiko.entity;

import java.math.BigDecimal;
import java.time.LocalDateTime;

public class ShoppingListItemEntity {

    private Long id;
    private Long householdId;
    private Long inventoryItemId;
    private boolean isManual;
    private boolean purchased;
    private BigDecimal purchasedQuantity;
    private LocalDateTime addedAt;
    // findByHouseholdId（在庫アイテムとのJOIN）でのみ設定される表示用の品名
    private String name;

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

    public Long getInventoryItemId() {
        return inventoryItemId;
    }

    public void setInventoryItemId(Long inventoryItemId) {
        this.inventoryItemId = inventoryItemId;
    }

    public boolean isManual() {
        return isManual;
    }

    public void setManual(boolean isManual) {
        this.isManual = isManual;
    }

    public boolean isPurchased() {
        return purchased;
    }

    public void setPurchased(boolean purchased) {
        this.purchased = purchased;
    }

    public BigDecimal getPurchasedQuantity() {
        return purchasedQuantity;
    }

    public void setPurchasedQuantity(BigDecimal purchasedQuantity) {
        this.purchasedQuantity = purchasedQuantity;
    }

    public LocalDateTime getAddedAt() {
        return addedAt;
    }

    public void setAddedAt(LocalDateTime addedAt) {
        this.addedAt = addedAt;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}

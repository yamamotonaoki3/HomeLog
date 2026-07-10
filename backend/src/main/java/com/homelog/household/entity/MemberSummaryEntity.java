package com.homelog.household.entity;

/**
 * household_membersとusersを結合した、世帯メンバー一覧表示用の射影結果。
 */
public class MemberSummaryEntity {

    private Long userId;
    private String displayName;

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }
}

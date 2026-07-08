package com.homelog.common.exception;

import java.util.List;

/**
 * 共通エラーレスポンス形式（docs/details/api-design.md 1-3章）。
 */
public record ErrorResponse(String code, String message, List<FieldDetail> details) {

    public static ErrorResponse of(String code, String message) {
        return new ErrorResponse(code, message, List.of());
    }

    public static ErrorResponse of(String code, String message, List<FieldDetail> details) {
        return new ErrorResponse(code, message, details);
    }

    public record FieldDetail(String field, String reason) {
    }
}

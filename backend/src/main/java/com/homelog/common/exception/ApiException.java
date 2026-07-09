package com.homelog.common.exception;

import org.springframework.http.HttpStatus;

/**
 * HTTPステータス・エラーコードを持つ共通例外の基底クラス。
 * GlobalExceptionHandlerで一括して{@link ErrorResponse}に変換する。
 */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public ApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }
}

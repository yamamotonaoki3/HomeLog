package com.homelog.common.exception;

import com.homelog.common.constant.ErrorCode;
import org.springframework.http.HttpStatus;

/**
 * パスワードリセットトークンが無効・期限切れ・使用済みの場合にスローする例外（400）。
 */
public class InvalidTokenException extends ApiException {

    public InvalidTokenException(String message) {
        super(HttpStatus.BAD_REQUEST, ErrorCode.INVALID_TOKEN.name(), message);
    }
}

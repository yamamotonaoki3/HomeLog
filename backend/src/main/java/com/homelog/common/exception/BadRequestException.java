package com.homelog.common.exception;

import com.homelog.common.constant.ErrorCode;
import org.springframework.http.HttpStatus;

/**
 * 入力形式の検証エラー（MethodArgumentNotValidException）ではない、業務ルール上の400エラーに使う
 * （例：既に世帯グループに所属している状態での作成/参加）。
 */
public class BadRequestException extends ApiException {

    public BadRequestException(String message) {
        super(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR.name(), message);
    }
}

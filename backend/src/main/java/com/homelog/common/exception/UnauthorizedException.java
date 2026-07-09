package com.homelog.common.exception;

import com.homelog.common.constant.ErrorCode;
import org.springframework.http.HttpStatus;

public class UnauthorizedException extends ApiException {

    public UnauthorizedException(String message) {
        super(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED.name(), message);
    }
}

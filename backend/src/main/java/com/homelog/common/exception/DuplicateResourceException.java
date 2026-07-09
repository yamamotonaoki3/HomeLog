package com.homelog.common.exception;

import com.homelog.common.constant.ErrorCode;
import org.springframework.http.HttpStatus;

public class DuplicateResourceException extends ApiException {

    public DuplicateResourceException(String message) {
        super(HttpStatus.CONFLICT, ErrorCode.DUPLICATE_RESOURCE.name(), message);
    }
}

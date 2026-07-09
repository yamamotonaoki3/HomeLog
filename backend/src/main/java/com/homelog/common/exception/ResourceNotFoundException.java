package com.homelog.common.exception;

import com.homelog.common.constant.ErrorCode;
import org.springframework.http.HttpStatus;

/**
 * 他人が所有するリソースや存在しないリソースを指定した場合にスローする例外。
 * common-notes.md 10章の方針により、403ではなく404として扱う。
 */
public class ResourceNotFoundException extends ApiException {

    public ResourceNotFoundException(String message) {
        super(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND.name(), message);
    }
}

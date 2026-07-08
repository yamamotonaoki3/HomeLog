package com.homelog.common.exception;

/**
 * 他人が所有するリソースや存在しないリソースを指定した場合にスローする例外。
 * common-notes.md 10章の方針により、403ではなく404として扱う。
 */
public class ResourceNotFoundException extends RuntimeException {

    public ResourceNotFoundException(String message) {
        super(message);
    }
}

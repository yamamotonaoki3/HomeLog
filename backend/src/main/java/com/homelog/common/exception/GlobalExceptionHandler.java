package com.homelog.common.exception;

import com.homelog.common.constant.ErrorCode;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ErrorResponse> handleApiException(ApiException ex) {
        return ResponseEntity.status(ex.getStatus())
                .body(ErrorResponse.of(ex.getCode(), ex.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(MethodArgumentNotValidException ex) {
        List<ErrorResponse.FieldDetail> details = ex.getBindingResult().getFieldErrors().stream()
                .map(error -> new ErrorResponse.FieldDetail(error.getField(), messageOf(error)))
                .toList();
        String message = details.isEmpty() ? "入力値が不正です" : details.get(0).reason();
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ErrorResponse.of(ErrorCode.VALIDATION_ERROR.name(), message, details));
    }

    private String messageOf(FieldError error) {
        String defaultMessage = error.getDefaultMessage();
        return defaultMessage != null ? defaultMessage : "不正な値です";
    }
}

package com.homelog.auth.controller;

import com.homelog.auth.dto.request.LoginRequest;
import com.homelog.auth.dto.request.PasswordResetConfirmRequest;
import com.homelog.auth.dto.request.PasswordResetRequestRequest;
import com.homelog.auth.dto.request.RefreshRequest;
import com.homelog.auth.dto.request.RegisterRequest;
import com.homelog.auth.dto.response.LoginResponse;
import com.homelog.auth.dto.response.MessageResponse;
import com.homelog.auth.dto.response.RefreshResponse;
import com.homelog.auth.dto.response.RegisterResponse;
import com.homelog.auth.service.AuthService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/register")
    public ResponseEntity<RegisterResponse> register(@Valid @RequestBody RegisterRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(authService.register(request));
    }

    @PostMapping("/login")
    public LoginResponse login(@Valid @RequestBody LoginRequest request) {
        return authService.login(request);
    }

    @PostMapping("/refresh")
    public RefreshResponse refresh(@Valid @RequestBody RefreshRequest request) {
        return authService.refresh(request);
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@Valid @RequestBody RefreshRequest request) {
        authService.logout(request);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/password-reset/request")
    public MessageResponse requestPasswordReset(@Valid @RequestBody PasswordResetRequestRequest request) {
        return authService.requestPasswordReset(request);
    }

    @PostMapping("/password-reset/confirm")
    public ResponseEntity<Void> confirmPasswordReset(@Valid @RequestBody PasswordResetConfirmRequest request) {
        authService.confirmPasswordReset(request);
        return ResponseEntity.ok().build();
    }
}

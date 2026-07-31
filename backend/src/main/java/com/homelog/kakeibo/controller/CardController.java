package com.homelog.kakeibo.controller;

import static com.homelog.common.security.CurrentUserProvider.currentUserId;

import com.homelog.kakeibo.dto.request.ChargeCardRequest;
import com.homelog.kakeibo.dto.request.CreateCardRequest;
import com.homelog.kakeibo.dto.request.UpdateCardRequest;
import com.homelog.kakeibo.dto.response.CardResponse;
import com.homelog.kakeibo.dto.response.ChargeResponse;
import com.homelog.kakeibo.service.CardService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/cards")
public class CardController {

    private final CardService cardService;

    public CardController(CardService cardService) {
        this.cardService = cardService;
    }

    @PostMapping
    public ResponseEntity<CardResponse> createCard(@Valid @RequestBody CreateCardRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(cardService.createCard(currentUserId(), request));
    }

    @PatchMapping("/{id}")
    public CardResponse updateCard(@PathVariable Long id, @Valid @RequestBody UpdateCardRequest request) {
        return cardService.updateCard(currentUserId(), id, request);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteCard(@PathVariable Long id) {
        cardService.deleteCard(currentUserId(), id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/charges")
    public ChargeResponse chargeCard(@PathVariable Long id, @Valid @RequestBody ChargeCardRequest request) {
        return cardService.chargeCard(currentUserId(), id, request);
    }
}

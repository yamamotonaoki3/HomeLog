package com.homelog.kakeibo.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.homelog.common.exception.BadRequestException;
import com.homelog.common.exception.ResourceNotFoundException;
import com.homelog.kakeibo.dto.request.CreateCardRequest;
import com.homelog.kakeibo.dto.request.UpdateCardRequest;
import com.homelog.kakeibo.dto.response.CardResponse;
import com.homelog.kakeibo.entity.AccountEntity;
import com.homelog.kakeibo.entity.CardEntity;
import com.homelog.kakeibo.mapper.AccountMapper;
import com.homelog.kakeibo.mapper.CardMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class CardServiceTest {

    @Mock
    private CardMapper cardMapper;
    @Mock
    private AccountMapper accountMapper;

    private CardService service() {
        return new CardService(cardMapper, accountMapper);
    }

    private AccountEntity accountOf(long id, long ownerUserId) {
        AccountEntity account = new AccountEntity();
        account.setId(id);
        account.setOwnerUserId(ownerUserId);
        return account;
    }

    private CardEntity cardOf(long id, long accountId) {
        CardEntity card = new CardEntity();
        card.setId(id);
        card.setAccountId(accountId);
        card.setName("旧カード名");
        return card;
    }

    @Test
    void createCard_正常系() {
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 1L));

        CardResponse response = service().createCard(1L, new CreateCardRequest(5L, "〇〇カード"));

        assertThat(response.name()).isEqualTo("〇〇カード");
        verify(cardMapper).insert(any(CardEntity.class));
    }

    @Test
    void createCard_他人の口座指定は400() {
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 999L));

        assertThatThrownBy(() -> service().createCard(1L, new CreateCardRequest(5L, "〇〇カード")))
                .isInstanceOf(BadRequestException.class);
        verify(cardMapper, never()).insert(any());
    }

    @Test
    void createCard_存在しない口座指定は400() {
        when(accountMapper.findById(5L)).thenReturn(null);

        assertThatThrownBy(() -> service().createCard(1L, new CreateCardRequest(5L, "〇〇カード")))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void updateCard_正常系() {
        when(cardMapper.findById(50L)).thenReturn(cardOf(50L, 5L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 1L));

        CardResponse response = service().updateCard(1L, 50L, new UpdateCardRequest("新カード名"));

        assertThat(response.name()).isEqualTo("新カード名");
        verify(cardMapper).update(50L, "新カード名");
    }

    @Test
    void updateCard_他人のカードは404() {
        when(cardMapper.findById(50L)).thenReturn(cardOf(50L, 5L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 999L));

        assertThatThrownBy(() -> service().updateCard(1L, 50L, new UpdateCardRequest("新カード名")))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void deleteCard_正常系() {
        when(cardMapper.findById(50L)).thenReturn(cardOf(50L, 5L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 1L));

        service().deleteCard(1L, 50L);

        verify(cardMapper).delete(50L);
    }

    @Test
    void deleteCard_他人のカードは404() {
        when(cardMapper.findById(50L)).thenReturn(cardOf(50L, 5L));
        when(accountMapper.findById(5L)).thenReturn(accountOf(5L, 999L));

        assertThatThrownBy(() -> service().deleteCard(1L, 50L)).isInstanceOf(ResourceNotFoundException.class);
        verify(cardMapper, never()).delete(anyLong());
    }

    @Test
    void deleteCard_存在しないカードは404() {
        when(cardMapper.findById(50L)).thenReturn(null);

        assertThatThrownBy(() -> service().deleteCard(1L, 50L)).isInstanceOf(ResourceNotFoundException.class);
    }
}

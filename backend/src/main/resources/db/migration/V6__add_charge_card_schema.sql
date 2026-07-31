-- F-11拡張: チャージ型カード対応
-- 対応: docs/details/features/F11_kakeibo_account.md
-- 口座・カード種別・チャージ残高は世帯共有ではなく完全に個人管理の情報（common-notes.md 2章参照）。

ALTER TABLE cards ADD COLUMN card_type VARCHAR(10) NOT NULL DEFAULT 'credit';
ALTER TABLE cards ADD CONSTRAINT chk_cards_card_type CHECK (card_type IN ('credit', 'charge'));
-- 単発のチャージ上限（9,999,999,999）より広い桁数を確保し、累積加減算で桁あふれしないようにする
ALTER TABLE cards ADD COLUMN balance NUMERIC(15, 0) NOT NULL DEFAULT 0;

CREATE TABLE card_charges (
    id BIGSERIAL PRIMARY KEY,
    card_id BIGINT NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
    from_account_id BIGINT NOT NULL REFERENCES accounts (id),
    amount NUMERIC(15, 0) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE expenses ADD COLUMN card_id BIGINT REFERENCES cards (id);

CREATE INDEX idx_card_charges_card_id ON card_charges (card_id);
CREATE INDEX idx_card_charges_from_account_id ON card_charges (from_account_id);
CREATE INDEX idx_expenses_card_id ON expenses (card_id);

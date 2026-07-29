-- F-11 口座・カード管理：口座・カードテーブルを追加し、支出テーブルに口座紐付けカラムを追加
-- 対応: docs/details/features/F11_kakeibo_account.md
-- 口座・残高は世帯共有ではなく完全に個人管理の情報（common-notes.md 2章参照）。

CREATE TABLE accounts (
    id BIGSERIAL PRIMARY KEY,
    household_id BIGINT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    owner_user_id BIGINT NOT NULL REFERENCES users (id),
    name VARCHAR(50) NOT NULL,
    type VARCHAR(20) NOT NULL,
    balance NUMERIC(10, 0) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cards (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE expenses ADD COLUMN account_id BIGINT REFERENCES accounts (id);

CREATE INDEX idx_accounts_household_id ON accounts (household_id);
CREATE INDEX idx_accounts_owner_user_id ON accounts (owner_user_id);
CREATE INDEX idx_cards_account_id ON cards (account_id);
CREATE INDEX idx_expenses_account_id ON expenses (account_id);

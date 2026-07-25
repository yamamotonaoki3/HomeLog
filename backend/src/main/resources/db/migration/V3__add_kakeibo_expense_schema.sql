-- F-03 個人支出管理：支出カテゴリーマスタ・支出テーブルを追加
-- 対応: docs/details/features/F03_kakeibo_expense.md
-- account_id/event_idはaccounts/eventsテーブルが未実装（F-06/F-11で対応）のため今回は含めない。

CREATE TABLE kakeibo_categories (
    id BIGSERIAL PRIMARY KEY,
    household_id BIGINT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE expenses (
    id BIGSERIAL PRIMARY KEY,
    household_id BIGINT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    payer_user_id BIGINT NOT NULL REFERENCES users (id),
    category_id BIGINT NOT NULL REFERENCES kakeibo_categories (id),
    amount NUMERIC(10, 0) NOT NULL,
    purpose VARCHAR(100) NOT NULL,
    memo VARCHAR(255),
    expense_date DATE NOT NULL,
    include_in_household_total BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kakeibo_categories_household_id ON kakeibo_categories (household_id);
CREATE INDEX idx_expenses_household_id ON expenses (household_id);
CREATE INDEX idx_expenses_payer_user_id ON expenses (payer_user_id);
CREATE INDEX idx_expenses_category_id ON expenses (category_id);

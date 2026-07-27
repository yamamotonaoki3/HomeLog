-- F-13 個人収入管理：収入カテゴリーマスタ・収入テーブルを追加
-- 対応: docs/details/features/F13_kakeibo_income.md
-- 収入は「世帯合計対象フラグ」を持たない純粋な個人管理とする（common-notes.md 8章参照）。

CREATE TABLE income_categories (
    id BIGSERIAL PRIMARY KEY,
    household_id BIGINT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE incomes (
    id BIGSERIAL PRIMARY KEY,
    household_id BIGINT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    earner_user_id BIGINT NOT NULL REFERENCES users (id),
    category_id BIGINT NOT NULL REFERENCES income_categories (id),
    amount NUMERIC(10, 0) NOT NULL,
    content VARCHAR(100) NOT NULL,
    memo VARCHAR(255),
    income_date DATE NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_income_categories_household_id ON income_categories (household_id);
CREATE INDEX idx_incomes_household_id ON incomes (household_id);
CREATE INDEX idx_incomes_earner_user_id ON incomes (earner_user_id);
CREATE INDEX idx_incomes_category_id ON incomes (category_id);

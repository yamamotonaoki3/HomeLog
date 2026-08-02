-- F-05 固定費管理：固定費テーブルを追加し、支出テーブルに固定費紐付けカラムを追加
-- 対応: docs/details/features/F05_kakeibo_fixedcost.md
-- 割り勘設定（fixed_cost_splits）はF-04未実装のため今回は含めない。

CREATE TABLE fixed_costs (
    id BIGSERIAL PRIMARY KEY,
    household_id BIGINT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    owner_user_id BIGINT REFERENCES users (id),
    created_by_user_id BIGINT NOT NULL REFERENCES users (id),
    name VARCHAR(50) NOT NULL,
    -- 単発の支出上限（9,999,999,999）と同じ桁数を確保する
    amount NUMERIC(10, 0) NOT NULL,
    payment_day INT NOT NULL,
    include_in_household_total BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_fixed_costs_payment_day CHECK (payment_day BETWEEN 1 AND 31)
);

ALTER TABLE expenses ADD COLUMN fixed_cost_id BIGINT REFERENCES fixed_costs (id) ON DELETE SET NULL;

CREATE INDEX idx_fixed_costs_household_id ON fixed_costs (household_id);
CREATE INDEX idx_fixed_costs_owner_user_id ON fixed_costs (owner_user_id);
CREATE INDEX idx_expenses_fixed_cost_id ON expenses (fixed_cost_id);

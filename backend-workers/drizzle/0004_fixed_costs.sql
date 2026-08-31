-- 既存Java実装のFlyway V7(固定費テーブル+expenses.fixed_cost_id)
-- + V8(同月二重計上防止のUNIQUE制約)+ V9(引き落とし元口座・カード列)相当。

CREATE TABLE fixed_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  owner_user_id INTEGER REFERENCES users(id),
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  account_id INTEGER REFERENCES accounts(id),
  card_id INTEGER REFERENCES cards(id),
  name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  payment_day INTEGER NOT NULL CHECK (payment_day BETWEEN 1 AND 31),
  include_in_household_total INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX idx_fixed_costs_household_id ON fixed_costs(household_id);
CREATE INDEX idx_fixed_costs_owner_user_id ON fixed_costs(owner_user_id);
CREATE INDEX idx_fixed_costs_account_id ON fixed_costs(account_id);
CREATE INDEX idx_fixed_costs_card_id ON fixed_costs(card_id);

-- expensesテーブルへの列追加。SQLiteはALTER TABLEでのFK追加時にON DELETE SET NULLを
-- 指定できる(テーブル再作成不要)。
ALTER TABLE expenses ADD COLUMN fixed_cost_id INTEGER REFERENCES fixed_costs(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN fixed_cost_year_month TEXT;

CREATE INDEX idx_expenses_fixed_cost_id ON expenses(fixed_cost_id);
-- UNIQUE制約はNULL同士を重複とみなさないため、fixed_cost_idがNULLの通常支出には影響しない。
CREATE UNIQUE INDEX uq_expenses_fixed_cost_year_month ON expenses(fixed_cost_id, fixed_cost_year_month);

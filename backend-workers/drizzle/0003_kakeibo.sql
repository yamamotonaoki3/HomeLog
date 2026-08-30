-- 既存Java実装のFlyway V3(支出)+V4(収入)+V5(口座)+V6(チャージ型カード)相当。
-- 金額はNUMERIC(10,0)/NUMERIC(15,0)(いずれも整数円)のため、SQLiteでもINTEGERにそのまま保持する。
-- F04(割り勘)・F06(イベント)は既存Java実装に無いため、account_id/card_id以外の
-- expenses拡張列(fixed_cost_id等、Phase 5で追加)はここでは作らない。

CREATE TABLE kakeibo_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_kakeibo_categories_household_id ON kakeibo_categories(household_id);

CREATE TABLE income_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_income_categories_household_id ON income_categories(household_id);

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  balance INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX idx_accounts_household_id ON accounts(household_id);
CREATE INDEX idx_accounts_owner_user_id ON accounts(owner_user_id);

CREATE TABLE cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  card_type TEXT NOT NULL DEFAULT 'credit' CHECK (card_type IN ('credit', 'charge')),
  balance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX idx_cards_account_id ON cards(account_id);

CREATE TABLE card_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  from_account_id INTEGER NOT NULL REFERENCES accounts(id),
  amount INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX idx_card_charges_card_id ON card_charges(card_id);
CREATE INDEX idx_card_charges_from_account_id ON card_charges(from_account_id);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  payer_user_id INTEGER NOT NULL REFERENCES users(id),
  category_id INTEGER NOT NULL REFERENCES kakeibo_categories(id),
  account_id INTEGER REFERENCES accounts(id),
  card_id INTEGER REFERENCES cards(id),
  amount INTEGER NOT NULL,
  purpose TEXT NOT NULL,
  memo TEXT,
  expense_date TEXT NOT NULL,
  include_in_household_total INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX idx_expenses_household_id ON expenses(household_id);
CREATE INDEX idx_expenses_payer_user_id ON expenses(payer_user_id);
CREATE INDEX idx_expenses_category_id ON expenses(category_id);
CREATE INDEX idx_expenses_account_id ON expenses(account_id);
CREATE INDEX idx_expenses_card_id ON expenses(card_id);

CREATE TABLE incomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  earner_user_id INTEGER NOT NULL REFERENCES users(id),
  category_id INTEGER NOT NULL REFERENCES income_categories(id),
  amount INTEGER NOT NULL,
  content TEXT NOT NULL,
  memo TEXT,
  income_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX idx_incomes_household_id ON incomes(household_id);
CREATE INDEX idx_incomes_earner_user_id ON incomes(earner_user_id);
CREATE INDEX idx_incomes_category_id ON incomes(category_id);

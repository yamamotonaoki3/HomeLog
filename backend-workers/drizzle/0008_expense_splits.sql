-- F-04 割り勘・精算管理(docs/details/features/F04_kakeibo_warikan.md)。
-- 支出登録時に割り勘対象者(世帯メンバー / 世帯外の人)を指定し、各自の負担額を保存する。
-- 精算は相手側(負担者)の承認があって初めて settled になる(common-notes.md 2章)。

-- 世帯外の精算相手。アプリ利用者ではないため users とは別管理。割り勘UIで名前を入力すると都度作成される。
CREATE TABLE external_persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX idx_external_persons_household_id ON external_persons(household_id);

-- 支出の割り勘内訳。1行 = 「支払者(expenses.payer_user_id)以外の1人が支払者に対して負う負担」。
-- 支払者自身の負担分は行を作らない(自分に対する精算は不要。端数は行を持たない支払者へ自然に寄る)。
CREATE TABLE expense_splits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  -- debtor_user_id(世帯内の負担者)と debtor_external_id(世帯外の負担者)はどちらか一方のみ設定する
  -- (アプリ層で検証。DB制約までは課さない。expenses の account_id / card_id 排他と同じ考え方)。
  debtor_user_id INTEGER REFERENCES users(id),
  debtor_external_id INTEGER REFERENCES external_persons(id),
  -- 入力モード。'ratio'(％入力) / 'amount'(金額入力)。デフォルト 'ratio'(common-notes.md 11章)。
  split_input_type TEXT NOT NULL DEFAULT 'ratio',
  -- 負担割合(%)。data-model.md は NUMERIC(5,2)。SQLite には固定小数点が無いため REAL。表示・集計用の参考値。
  split_ratio REAL NOT NULL,
  -- 負担額(整数円)。％入力時は split_ratio から自動計算、金額入力時はユーザー入力値。
  amount_due INTEGER NOT NULL,
  -- unpaid(未請求) / requested(請求中) / approval_requested(受領承認待ち) / pending(保留中) / settled(精算済み)。
  status TEXT NOT NULL DEFAULT 'unpaid',
  requested_at TEXT,
  settled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX idx_expense_splits_expense_id ON expense_splits(expense_id);
CREATE INDEX idx_expense_splits_debtor_user_id ON expense_splits(debtor_user_id);

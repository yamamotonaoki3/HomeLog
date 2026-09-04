-- F-05 §6-3 固定費の割り勘設定（docs/details/features/F05_kakeibo_fixedcost.md）。
-- 家賃・水道代など毎月同じ割合で割り勘する固定費のために、固定費自体に割り勘設定を持たせる。
-- 毎月の自動計上時、この設定を雛形として expense_splits（status='unpaid'）を生成する。
-- F-04 の expense_splits と違い、世帯外の相手（debtor_external_id）は持たない（世帯内メンバーのみ）。

CREATE TABLE fixed_cost_splits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fixed_cost_id INTEGER NOT NULL REFERENCES fixed_costs(id) ON DELETE CASCADE,
  -- 負担者（世帯内メンバー）。登録者本人は含めない。
  debtor_user_id INTEGER NOT NULL REFERENCES users(id),
  -- 'ratio'（％入力） / 'amount'（金額入力）。1つの固定費内では全行同じモード。
  split_input_type TEXT NOT NULL DEFAULT 'ratio',
  -- 負担割合(%)。小数第2位まで持つ参考値。
  split_ratio REAL NOT NULL,
  -- 負担額（整数円）。登録時点の固定費金額に対する計算値。自動計上時に現在金額で再計算する。
  amount_due INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX idx_fixed_cost_splits_fixed_cost_id ON fixed_cost_splits(fixed_cost_id);

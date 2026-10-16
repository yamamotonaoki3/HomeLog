-- 固定費の自動計上で作られた支出を削除した月を記録し、同じ月に再計上しないようにする(#275)。
CREATE TABLE fixed_cost_posting_suppressions (
  fixed_cost_id INTEGER NOT NULL REFERENCES fixed_costs(id) ON DELETE CASCADE,
  year_month TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  PRIMARY KEY (fixed_cost_id, year_month)
);

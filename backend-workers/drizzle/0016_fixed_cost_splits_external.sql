-- Identity exclusivity is validated by the application (no CHECK).
CREATE TABLE fixed_cost_splits_new (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 fixed_cost_id INTEGER NOT NULL REFERENCES fixed_costs(id) ON DELETE CASCADE,
 debtor_user_id INTEGER REFERENCES users(id),
 debtor_external_id INTEGER REFERENCES external_persons(id),
 split_input_type TEXT NOT NULL DEFAULT 'ratio',
 split_ratio REAL NOT NULL,
 amount_due INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
INSERT INTO fixed_cost_splits_new (id, fixed_cost_id, debtor_user_id, split_input_type, split_ratio, amount_due, created_at)
 SELECT id, fixed_cost_id, debtor_user_id, split_input_type, split_ratio, amount_due, created_at FROM fixed_cost_splits;
DROP TABLE fixed_cost_splits;
ALTER TABLE fixed_cost_splits_new RENAME TO fixed_cost_splits;
CREATE INDEX idx_fixed_cost_splits_fixed_cost_id ON fixed_cost_splits(fixed_cost_id);

-- F-05 固定費管理：引き落とし元（口座・カード）の指定を追加
-- 対応: docs/details/features/F05_kakeibo_fixedcost.md
-- expenses.account_id / expenses.card_id と同様、ON DELETE制約は付与せずアプリ側で使用中チェックを行う。

ALTER TABLE fixed_costs ADD COLUMN account_id BIGINT REFERENCES accounts (id);
ALTER TABLE fixed_costs ADD COLUMN card_id BIGINT REFERENCES cards (id);

CREATE INDEX idx_fixed_costs_account_id ON fixed_costs (account_id);
CREATE INDEX idx_fixed_costs_card_id ON fixed_costs (card_id);

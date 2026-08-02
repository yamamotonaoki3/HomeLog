-- F-05 固定費管理：同一固定費の同月分が複数回計上されることを防止
-- 複数アプリケーションインスタンスによる同時実行時もDBレベルで一意性を保証する。
-- 式インデックス（date_trunc等）はテスト用DB（H2）が式インデックスをサポートしないため使わず、
-- 年月を保持する専用カラムを追加し、通常の複合ユニーク制約で一意性を保証する。
-- UNIQUE制約はNULL同士を重複とみなさないため、fixed_cost_idがNULLの通常支出には影響しない。

ALTER TABLE expenses ADD COLUMN fixed_cost_year_month VARCHAR(7);

CREATE UNIQUE INDEX uq_expenses_fixed_cost_year_month
    ON expenses (fixed_cost_id, fixed_cost_year_month);

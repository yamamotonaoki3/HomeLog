-- 割り勘精算で自動作成した収入・支出に、元の割り勘内訳IDを記録する(#275)。
-- この列がある明細は編集・削除APIで拒否する。過去の明細は区別できないためNULLのまま(通常の明細として扱う)。
-- 元内訳はsettled後は削除できない(支出本体の編集・削除も拒否される)ため、ON DELETE SET NULLとして
-- 世帯削除などのカスケード削除を妨げないようにする。
ALTER TABLE expenses ADD COLUMN settlement_split_id INTEGER REFERENCES expense_splits(id) ON DELETE SET NULL;
ALTER TABLE incomes ADD COLUMN settlement_split_id INTEGER REFERENCES expense_splits(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX expenses_settlement_split_id_unique ON expenses(settlement_split_id);
CREATE UNIQUE INDEX incomes_settlement_split_id_unique ON incomes(settlement_split_id);

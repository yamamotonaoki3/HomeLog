-- 固定費の自動計上で取りこぼした今月分を回収するための「設定の有効開始日」(#396)。
-- JST日付(YYYY-MM-DD)。登録日・変更日より後に迎えた支払日だけを回収対象にし、それ以前へは遡及しない。
-- NULLは履歴なし(従来どおり当日の支払日だけ計上し、回収しない)。登録・変更のAPIは必ず設定する。
ALTER TABLE fixed_costs ADD COLUMN effective_from TEXT;

-- 既存の固定費は、いつ設定を変更したかの履歴がないため、このマイグレーションの適用日(JST)から有効とする。
-- 適用日以前の支払日は回収しない。
UPDATE fixed_costs SET effective_from = date('now', '+9 hours');

-- 同じ買い物リスト状態を読んだ並行購入を検出する。Cronによる数量変化とは区別する。
ALTER TABLE shopping_list_items ADD COLUMN purchase_revision INTEGER NOT NULL DEFAULT 0;

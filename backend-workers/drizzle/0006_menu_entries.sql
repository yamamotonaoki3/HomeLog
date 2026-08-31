-- F-10 献立表(docs/details/features/F10_kondate_menu.md)。
-- 週単位(week_start_date=その週の月曜日)の「作りたい料理リスト」。1行=リストの1品。
-- recipe_id(確定登録)とfree_text_memo(ラフ登録)はどちらか一方のみ設定する(アプリ層で検証)。

CREATE TABLE menu_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  -- レシピが削除されても献立リストの行自体は残し、recipe_idだけNULLになる
  -- (Phase 7-2実装時に保留していた設計判断。レシピは世帯メンバー全員が自由に編集可能な
  -- 気軽なデータであり、口座・カードのような厳格な使用中チェックは課さない方針とした)。
  recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  free_text_memo TEXT,
  week_start_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
-- 週指定での一覧取得(GET /api/menu-entries?weekStartDate=...)が主なアクセスパターンのため、
-- household_id + week_start_dateの複合インデックスを作成する。
CREATE INDEX idx_menu_entries_household_week ON menu_entries(household_id, week_start_date);

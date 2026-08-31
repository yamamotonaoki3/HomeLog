-- F-09 レシピ登録・管理(docs/details/features/F09_kondate_recipe.md)。
-- 今回は手動登録(source_type='manual')のみを実装対象とするが、将来のOCR/WEB登録拡張時に
-- テーブル再設計が不要になるよう、url/thumbnail_url/memo列も併せて作成しておく(現時点では未使用)。

CREATE TABLE recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  ingredients TEXT,
  steps TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual',
  url TEXT,
  thumbnail_url TEXT,
  memo TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
-- household_idで検索する(GET /api/recipes)頻度が高いため、検索を高速化するインデックスを作成する。
CREATE INDEX idx_recipes_household_id ON recipes(household_id);

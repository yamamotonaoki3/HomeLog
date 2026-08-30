-- 既存Java実装のFlyway V1(zaiko_categories/stores/inventory_items/shopping_list_items)
-- + V2(CASCADE化)相当。
--
-- quantity/threshold/purchased_quantityは、既存JavaのNUMERIC(6,1)相当を
-- SQLiteのfloat誤差を避けるため「小数点第一位までの値を10倍した整数」として保持する
-- (quantity_tenths等)。API層でのみ10で除算/乗算して既存の数値レスポンス形式を再現する。

CREATE TABLE zaiko_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_zaiko_categories_household_id ON zaiko_categories(household_id);

CREATE TABLE stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);
CREATE INDEX idx_stores_household_id ON stores(household_id);

CREATE TABLE inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES zaiko_categories(id) ON DELETE CASCADE,
  store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
  quantity_tenths INTEGER NOT NULL,
  threshold_tenths INTEGER NOT NULL
);
CREATE INDEX idx_inventory_items_household_id ON inventory_items(household_id);

-- inventory_item_idにUNIQUE制約を付与し、1在庫アイテムにつき買い物リスト項目は1件のみとする。
-- 手動追加・自動同期のどちらも「存在確認してから挿入」という手順のため、同時リクエストによる
-- 重複挿入を防ぐ最終防衛線とする(既存Java実装には無い改善だが、破壊的変更ではない)。
CREATE TABLE shopping_list_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  inventory_item_id INTEGER NOT NULL UNIQUE REFERENCES inventory_items(id) ON DELETE CASCADE,
  is_manual INTEGER NOT NULL,
  purchased INTEGER NOT NULL DEFAULT 0,
  purchased_quantity_tenths INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX idx_shopping_list_items_household_id ON shopping_list_items(household_id);
CREATE INDEX idx_shopping_list_items_inventory_item_id ON shopping_list_items(inventory_item_id);

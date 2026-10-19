-- 既存行はNULLのまま残し、NFKCによる比較はJSの事前チェックで行う。
-- 既存の重複データを許容するためUNIQUE制約は付けない。
ALTER TABLE inventory_items ADD COLUMN normalized_name TEXT;

CREATE INDEX inventory_items_household_normalized_name_idx
  ON inventory_items (household_id, normalized_name);

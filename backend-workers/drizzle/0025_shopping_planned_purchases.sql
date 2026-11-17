ALTER TABLE shopping_list_items ADD COLUMN planned_quantity_tenths INTEGER NOT NULL DEFAULT 10
  CHECK(typeof(planned_quantity_tenths) = 'integer' AND planned_quantity_tenths BETWEEN 1 AND 999999);
ALTER TABLE shopping_list_items ADD COLUMN planned_quantity_explicit INTEGER NOT NULL DEFAULT 0
  CHECK(planned_quantity_explicit IN (0, 1));

CREATE TABLE shopping_purchase_requests (
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_status INTEGER CHECK(response_status IS NULL OR response_status IN (200, 400, 404, 409)),
  response_json TEXT,
  guard INTEGER NOT NULL DEFAULT 1 CONSTRAINT shopping_purchase_guard CHECK(guard = 1),
  created_at TEXT NOT NULL DEFAULT(current_timestamp),
  PRIMARY KEY(household_id, actor_user_id, request_id)
);

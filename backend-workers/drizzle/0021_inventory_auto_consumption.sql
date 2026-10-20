-- Existing inventory stays disabled; quantities and shopping entries are untouched.
ALTER TABLE inventory_items ADD COLUMN daily_consumption_tenths INTEGER DEFAULT NULL
  CHECK (daily_consumption_tenths IS NULL OR (typeof(daily_consumption_tenths) = 'integer' AND daily_consumption_tenths BETWEEN 1 AND 999999));
ALTER TABLE inventory_items ADD COLUMN last_consumed_on TEXT DEFAULT NULL;
ALTER TABLE inventory_items ADD COLUMN auto_consumption_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (auto_consumption_enabled IN (0, 1) AND
    (auto_consumption_enabled = 0 OR (daily_consumption_tenths IS NOT NULL AND last_consumed_on IS NOT NULL)));
ALTER TABLE inventory_items ADD COLUMN consumption_revision INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(consumption_revision) = 'integer' AND consumption_revision >= 0);
CREATE INDEX inventory_consumption_due_idx ON inventory_items(auto_consumption_enabled, id);

-- #554: additive plan metadata. NULL is legacy usage, never an inferred count.
-- Item-level enablement applies only after an explicit new-plan save.
ALTER TABLE inventory_items ADD COLUMN menu_plan_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (menu_plan_enabled IN (0, 1));
ALTER TABLE inventory_items ADD COLUMN menu_plan_revision INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(menu_plan_revision) = 'integer' AND menu_plan_revision BETWEEN 0 AND 9007199254740991);

ALTER TABLE inventory_menu_links ADD COLUMN remaining_count INTEGER DEFAULT NULL
  CHECK (remaining_count IS NULL OR (typeof(remaining_count) = 'integer' AND remaining_count BETWEEN 0 AND 99999));
ALTER TABLE inventory_menu_links ADD COLUMN memo TEXT DEFAULT NULL
  CHECK (memo IS NULL OR length(memo) <= 255);

-- Historical events remain stock-only on undo, including after their link's conversion.
-- New count events retain the original link only while that link survives unlink.
ALTER TABLE menu_consumption_events ADD COLUMN plan_count_delta INTEGER DEFAULT NULL
  CHECK (plan_count_delta IS NULL OR plan_count_delta = 1);
ALTER TABLE menu_consumption_events ADD COLUMN inventory_menu_link_id INTEGER
  REFERENCES inventory_menu_links(id) ON DELETE SET NULL;

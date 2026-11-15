ALTER TABLE menu_entries ADD COLUMN recipe_title_snapshot TEXT;

-- Historical renames cannot be reconstructed; use the live title available at migration time.
UPDATE menu_entries
SET recipe_title_snapshot = (
  SELECT COALESCE(r.title, l.recipe_title_snapshot)
  FROM inventory_menu_links l
  LEFT JOIN recipes r ON r.id = menu_entries.recipe_id AND r.household_id = menu_entries.household_id
  WHERE l.id = menu_entries.inventory_menu_link_id AND l.household_id = menu_entries.household_id
)
WHERE inventory_menu_link_id IS NOT NULL;

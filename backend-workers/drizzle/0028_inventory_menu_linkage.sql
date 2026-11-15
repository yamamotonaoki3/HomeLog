-- #547 在庫別メニュー・実食・週持越し（既存行は未連携のまま）
CREATE TABLE inventory_menu_links (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
 inventory_item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
 recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
 recipe_title_snapshot TEXT NOT NULL,
 usage_tenths INTEGER NOT NULL DEFAULT 10 CONSTRAINT menu_link_usage CHECK(usage_tenths BETWEEN 1 AND 999999),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)),
 carry_enabled INTEGER NOT NULL DEFAULT 0 CHECK(carry_enabled IN(0,1) AND (carry_enabled=0 OR enabled=1)),
 starts_on TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0 CONSTRAINT menu_link_revision CHECK(revision BETWEEN 0 AND 9007199254740991),
 created_at TEXT NOT NULL DEFAULT(current_timestamp)
);
CREATE UNIQUE INDEX inventory_menu_active_recipe_unique ON inventory_menu_links(inventory_item_id,recipe_id) WHERE enabled=1;
CREATE INDEX inventory_menu_household ON inventory_menu_links(household_id);
ALTER TABLE menu_entries ADD COLUMN inventory_menu_link_id INTEGER REFERENCES inventory_menu_links(id) ON DELETE SET NULL;
ALTER TABLE menu_entries ADD COLUMN usage_tenths INTEGER CHECK(usage_tenths IS NULL OR usage_tenths BETWEEN 1 AND 999999);
ALTER TABLE menu_entries ADD COLUMN meal_state TEXT NOT NULL DEFAULT 'uneaten' CHECK(meal_state IN('uneaten','eaten'));
ALTER TABLE menu_entries ADD COLUMN meal_revision INTEGER NOT NULL DEFAULT 0 CHECK(meal_revision BETWEEN 0 AND 9007199254740991);
ALTER TABLE menu_entries ADD COLUMN consumed_event_id TEXT;
CREATE UNIQUE INDEX menu_entries_link_week_unique ON menu_entries(inventory_menu_link_id,week_start_date);
CREATE TABLE menu_consumption_events (
 id TEXT PRIMARY KEY,
 household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
 menu_entry_id INTEGER REFERENCES menu_entries(id) ON DELETE SET NULL,
 inventory_item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
 quantity_tenths INTEGER NOT NULL CHECK(quantity_tenths BETWEEN 1 AND 999999),
 undone_at TEXT,
 created_at TEXT NOT NULL DEFAULT(current_timestamp)
);
CREATE TABLE menu_operation_requests (
 household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
 actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 request_json TEXT NOT NULL,
 response_status INTEGER NOT NULL,
 response_json TEXT NOT NULL,
 guard INTEGER NOT NULL DEFAULT 1 CONSTRAINT menu_operation_guard CHECK(guard=1),
 created_at TEXT NOT NULL DEFAULT(current_timestamp),
 PRIMARY KEY(household_id,actor_user_id,request_id)
);
CREATE TRIGGER inventory_menu_zero_stop AFTER UPDATE OF quantity_tenths ON inventory_items WHEN NEW.quantity_tenths=0 BEGIN
 UPDATE inventory_menu_links SET carry_enabled=0,revision=revision+1 WHERE inventory_item_id=NEW.id AND carry_enabled=1;
END;
CREATE TRIGGER inventory_menu_delete_stop BEFORE DELETE ON inventory_items BEGIN
 UPDATE inventory_menu_links SET enabled=0,carry_enabled=0,revision=revision+1 WHERE inventory_item_id=OLD.id AND (enabled=1 OR carry_enabled=1);
END;
CREATE TRIGGER recipe_menu_delete_stop BEFORE DELETE ON recipes BEGIN
 UPDATE inventory_menu_links SET enabled=0,carry_enabled=0,revision=revision+1 WHERE recipe_id=OLD.id AND (enabled=1 OR carry_enabled=1);
END;
CREATE TRIGGER inventory_menu_daily_guard BEFORE UPDATE OF auto_consumption_enabled ON inventory_items WHEN NEW.auto_consumption_enabled=1 BEGIN
 SELECT RAISE(ABORT,'menu_link_daily_conflict') WHERE EXISTS(SELECT 1 FROM inventory_menu_links WHERE inventory_item_id=NEW.id AND enabled=1);
END;
CREATE TRIGGER menu_link_insert_guard BEFORE INSERT ON inventory_menu_links WHEN NEW.enabled=1 BEGIN
 SELECT RAISE(ABORT,'menu_link_invalid_reference') WHERE NOT EXISTS(SELECT 1 FROM inventory_items i JOIN recipes r ON r.id=NEW.recipe_id WHERE i.id=NEW.inventory_item_id AND i.household_id=NEW.household_id AND r.household_id=NEW.household_id);
 SELECT RAISE(ABORT,'menu_link_daily_conflict') WHERE EXISTS(SELECT 1 FROM inventory_items WHERE id=NEW.inventory_item_id AND auto_consumption_enabled=1);
 SELECT RAISE(ABORT,'menu_link_zero_carry') WHERE NEW.carry_enabled=1 AND EXISTS(SELECT 1 FROM inventory_items WHERE id=NEW.inventory_item_id AND quantity_tenths=0);
END;
CREATE TRIGGER menu_link_update_guard BEFORE UPDATE ON inventory_menu_links WHEN NEW.enabled=1 BEGIN
 SELECT RAISE(ABORT,'menu_link_invalid_reference') WHERE NOT EXISTS(SELECT 1 FROM inventory_items i JOIN recipes r ON r.id=NEW.recipe_id WHERE i.id=NEW.inventory_item_id AND i.household_id=NEW.household_id AND r.household_id=NEW.household_id);
 SELECT RAISE(ABORT,'menu_link_daily_conflict') WHERE EXISTS(SELECT 1 FROM inventory_items WHERE id=NEW.inventory_item_id AND auto_consumption_enabled=1);
 SELECT RAISE(ABORT,'menu_link_zero_carry') WHERE NEW.carry_enabled=1 AND EXISTS(SELECT 1 FROM inventory_items WHERE id=NEW.inventory_item_id AND quantity_tenths=0);
END;

-- #554: every inventory/link writer invalidates the aggregate CAS token.
-- UPDATE OF excludes menu_plan_revision itself, so the bounded increment cannot recurse.
CREATE TRIGGER inventory_menu_plan_revision_limit BEFORE UPDATE OF name,normalized_name,category_id,store_id,price,quantity_tenths,threshold_tenths,daily_consumption_tenths,auto_consumption_enabled,last_consumed_on,consumption_revision,menu_plan_enabled ON inventory_items WHEN OLD.menu_plan_revision=9007199254740991 BEGIN
 SELECT RAISE(ABORT,'menu_plan_revision_exhausted');
END;
CREATE TRIGGER inventory_menu_plan_revision AFTER UPDATE OF name,normalized_name,category_id,store_id,price,quantity_tenths,threshold_tenths,daily_consumption_tenths,auto_consumption_enabled,last_consumed_on,consumption_revision,menu_plan_enabled ON inventory_items BEGIN
 UPDATE inventory_items SET menu_plan_revision=menu_plan_revision+1 WHERE id=NEW.id;
END;
CREATE TRIGGER inventory_menu_plan_link_insert AFTER INSERT ON inventory_menu_links BEGIN
 SELECT RAISE(ABORT,'menu_plan_revision_exhausted') WHERE EXISTS(SELECT 1 FROM inventory_items WHERE id=NEW.inventory_item_id AND menu_plan_revision=9007199254740991);
 UPDATE inventory_items SET menu_plan_revision=menu_plan_revision+1 WHERE id=NEW.inventory_item_id;
END;
CREATE TRIGGER inventory_menu_plan_link_update AFTER UPDATE ON inventory_menu_links BEGIN
 SELECT RAISE(ABORT,'menu_plan_revision_exhausted') WHERE EXISTS(SELECT 1 FROM inventory_items WHERE (id=OLD.inventory_item_id OR id=NEW.inventory_item_id) AND menu_plan_revision=9007199254740991);
 UPDATE inventory_items SET menu_plan_revision=menu_plan_revision+1 WHERE id=OLD.inventory_item_id OR id=NEW.inventory_item_id;
END;
CREATE TRIGGER inventory_menu_plan_link_delete AFTER DELETE ON inventory_menu_links BEGIN
 SELECT RAISE(ABORT,'menu_plan_revision_exhausted') WHERE EXISTS(SELECT 1 FROM inventory_items WHERE id=OLD.inventory_item_id AND menu_plan_revision=9007199254740991);
 UPDATE inventory_items SET menu_plan_revision=menu_plan_revision+1 WHERE id=OLD.inventory_item_id;
END;

-- A full save releases old reservations before its item write, then installs the
-- submitted set. External writers always see a committed, guarded allocation.
CREATE TRIGGER inventory_menu_plan_stock_guard BEFORE UPDATE OF quantity_tenths ON inventory_items BEGIN
 SELECT RAISE(ABORT,'menu_plan_allocation') WHERE NEW.quantity_tenths <
  (SELECT COALESCE(SUM(remaining_count),0)*10 FROM inventory_menu_links WHERE inventory_item_id=NEW.id AND remaining_count IS NOT NULL);
END;
DROP TRIGGER inventory_menu_daily_guard;
CREATE TRIGGER inventory_menu_daily_guard BEFORE UPDATE OF auto_consumption_enabled ON inventory_items WHEN NEW.auto_consumption_enabled=1 BEGIN
 SELECT RAISE(ABORT,'menu_link_daily_conflict') WHERE EXISTS(SELECT 1 FROM inventory_menu_links WHERE inventory_item_id=NEW.id AND ((remaining_count IS NULL AND enabled=1) OR remaining_count>0));
END;
DROP TRIGGER inventory_menu_zero_stop;
CREATE TRIGGER inventory_menu_zero_stop AFTER UPDATE OF quantity_tenths ON inventory_items WHEN NEW.quantity_tenths=0 BEGIN
 UPDATE inventory_menu_links SET carry_enabled=0,revision=revision+1 WHERE inventory_item_id=NEW.id AND remaining_count IS NULL AND carry_enabled=1;
END;
DROP TRIGGER menu_link_insert_guard;
CREATE TRIGGER menu_link_insert_guard BEFORE INSERT ON inventory_menu_links WHEN NEW.enabled=1 BEGIN
 SELECT RAISE(ABORT,'menu_link_invalid_reference') WHERE NOT EXISTS(SELECT 1 FROM inventory_items i JOIN recipes r ON r.id=NEW.recipe_id WHERE i.id=NEW.inventory_item_id AND i.household_id=NEW.household_id AND r.household_id=NEW.household_id);
 SELECT RAISE(ABORT,'menu_link_daily_conflict') WHERE (NEW.remaining_count IS NULL OR NEW.remaining_count>0) AND EXISTS(SELECT 1 FROM inventory_items WHERE id=NEW.inventory_item_id AND auto_consumption_enabled=1);
 SELECT RAISE(ABORT,'menu_link_zero_carry') WHERE NEW.remaining_count IS NULL AND NEW.carry_enabled=1 AND EXISTS(SELECT 1 FROM inventory_items WHERE id=NEW.inventory_item_id AND quantity_tenths=0);
END;
DROP TRIGGER menu_link_update_guard;
CREATE TRIGGER menu_link_update_guard BEFORE UPDATE ON inventory_menu_links WHEN NEW.enabled=1 BEGIN
 SELECT RAISE(ABORT,'menu_link_invalid_reference') WHERE NOT EXISTS(SELECT 1 FROM inventory_items i JOIN recipes r ON r.id=NEW.recipe_id WHERE i.id=NEW.inventory_item_id AND i.household_id=NEW.household_id AND r.household_id=NEW.household_id);
 SELECT RAISE(ABORT,'menu_link_daily_conflict') WHERE (NEW.remaining_count IS NULL OR NEW.remaining_count>0) AND EXISTS(SELECT 1 FROM inventory_items WHERE id=NEW.inventory_item_id AND auto_consumption_enabled=1);
 SELECT RAISE(ABORT,'menu_link_zero_carry') WHERE NEW.remaining_count IS NULL AND NEW.carry_enabled=1 AND EXISTS(SELECT 1 FROM inventory_items WHERE id=NEW.inventory_item_id AND quantity_tenths=0);
END;
CREATE TRIGGER inventory_menu_plan_allocation_insert BEFORE INSERT ON inventory_menu_links WHEN NEW.remaining_count IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'menu_plan_allocation') WHERE NEW.remaining_count*10+(SELECT COALESCE(SUM(remaining_count),0)*10 FROM inventory_menu_links WHERE inventory_item_id=NEW.inventory_item_id) > (SELECT quantity_tenths FROM inventory_items WHERE id=NEW.inventory_item_id);
 SELECT RAISE(ABORT,'menu_link_daily_conflict') WHERE NEW.remaining_count>0 AND EXISTS(SELECT 1 FROM inventory_items WHERE id=NEW.inventory_item_id AND auto_consumption_enabled=1);
END;
CREATE TRIGGER inventory_menu_plan_allocation_update BEFORE UPDATE OF remaining_count,inventory_item_id ON inventory_menu_links WHEN NEW.remaining_count IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'menu_plan_allocation') WHERE NEW.remaining_count*10+(SELECT COALESCE(SUM(remaining_count),0)*10 FROM inventory_menu_links WHERE inventory_item_id=NEW.inventory_item_id AND id<>OLD.id) > (SELECT quantity_tenths FROM inventory_items WHERE id=NEW.inventory_item_id);
 SELECT RAISE(ABORT,'menu_link_daily_conflict') WHERE NEW.remaining_count>0 AND EXISTS(SELECT 1 FROM inventory_items WHERE id=NEW.inventory_item_id AND auto_consumption_enabled=1);
END;

import { currentWeekStart } from './date'

/** 今のJST週だけを独立した継続設定から補完する。既存行・在庫・食事履歴は変更しない。 */
export async function carryMenuEntries(db: D1Database, now: Date): Promise<number> {
  const week = currentWeekStart(new Date(now.getTime() + 9 * 60 * 60 * 1000))
  const result = await db.prepare(`
    INSERT INTO menu_entries (household_id, recipe_id, week_start_date, inventory_menu_link_id, usage_tenths, recipe_title_snapshot)
    SELECT l.household_id, l.recipe_id, ?1, l.id, l.usage_tenths, r.title
    FROM inventory_menu_links l
    JOIN inventory_items i ON i.id = l.inventory_item_id AND i.household_id = l.household_id
    JOIN recipes r ON r.id = l.recipe_id AND r.household_id = l.household_id
    WHERE l.enabled = 1 AND l.carry_enabled = 1 AND l.starts_on <= ?1
      AND i.quantity_tenths > 0 AND i.auto_consumption_enabled = 0
    ON CONFLICT (inventory_menu_link_id, week_start_date) DO NOTHING
  `).bind(week).run()
  return result.meta.changes
}

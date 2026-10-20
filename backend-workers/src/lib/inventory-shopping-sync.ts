/** Must immediately follow the inventory write in the same D1 batch.
 * The INSERT uses changes() from that write: a stale/replayed update cannot
 * resurrect a shopping entry the user removed. Both predicates read live stock.
 * null itemId means the immediately preceding INSERT: capture last_insert_rowid()
 * before inserting a shopping entry. New stock has no automatic entry to delete.
 */
export function inventoryShoppingSync(db: D1Database, itemId: number | null, householdId: number): D1PreparedStatement[] {
  const insert = db.prepare(`INSERT INTO shopping_list_items
      (household_id, inventory_item_id, is_manual, purchased, purchased_quantity_tenths)
      SELECT household_id, id, 0, 0, 0 FROM inventory_items
      WHERE id = ${itemId === null ? 'last_insert_rowid()' : '?'} AND household_id = ? AND quantity_tenths <= threshold_tenths AND changes() > 0
      ON CONFLICT(inventory_item_id) DO NOTHING`).bind(...(itemId === null ? [] : [itemId]), householdId)
  if (itemId === null) return [insert]
  return [insert,
    db.prepare(`DELETE FROM shopping_list_items WHERE inventory_item_id = ? AND household_id = ? AND is_manual = 0
      AND EXISTS (SELECT 1 FROM inventory_items WHERE id = ? AND household_id = ? AND quantity_tenths > threshold_tenths)`)
      .bind(itemId, householdId, itemId, householdId),
  ]
}

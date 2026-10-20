import { isValidCalendarDate } from './date'

const DAY = 86400000
export function consumptionDate(time = Date.now()): string {
  return new Date(time + 9 * 3600000).toISOString().slice(0, 10)
}
/** Before JST 01:00, today's scheduled consumption has not arrived yet. */
export function latestConsumptionDate(time = Date.now()): string {
  return consumptionDate(time - 3600000)
}
export function consumptionDays(from: string, to: string): number {
  if (!isValidCalendarDate(from) || !isValidCalendarDate(to)) throw new Error('Invalid consumption date')
  return Math.max(0, (Date.parse(to) - Date.parse(from)) / DAY)
}
/** Build both statements without reading inventory into a Worker snapshot.
 * D1 batch serializes the INSERT and UPDATE atomically against manual writes.
 * Insert first so its predicate can use the old baseline: replayed/older runs
 * cannot resurrect deleted entries, even when another item still needs catch-up.
 */
export function consumptionStatements(db: D1Database, targetDate: string): D1PreparedStatement[] {
  if (!isValidCalendarDate(targetDate)) throw new Error('Invalid consumption date')
  const eligible = `auto_consumption_enabled = 1 AND daily_consumption_tenths IS NOT NULL
    AND last_consumed_on < ?`
  const remaining = `max(0, quantity_tenths - daily_consumption_tenths *
    CAST(julianday(?) - julianday(last_consumed_on) AS INTEGER))`
  return [
    db.prepare(`INSERT INTO shopping_list_items
      (household_id, inventory_item_id, is_manual, purchased, purchased_quantity_tenths)
      SELECT household_id, id, 0, 0, 0 FROM inventory_items
      WHERE ${eligible} AND ${remaining} <= threshold_tenths
      ON CONFLICT(inventory_item_id) DO NOTHING`).bind(targetDate, targetDate),
    db.prepare(`UPDATE inventory_items SET quantity_tenths = ${remaining}, last_consumed_on = ?
      WHERE ${eligible}`).bind(targetDate, targetDate, targetDate),
  ]
}
export async function consumeInventoryForDate(db: D1Database, targetDate: string): Promise<void> {
  await db.batch(consumptionStatements(db, targetDate))
}

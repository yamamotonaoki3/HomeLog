import { currentWeekStart } from './date'

// nowはUTCの実時刻。予定時刻が古いCronの再実行でも、現在の週まで追いつく。
export async function purgePastMenuEntries(db: D1Database, now: Date): Promise<number> {
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const weekStart = currentWeekStart(jstNow)
  const result = await db.prepare('DELETE FROM menu_entries WHERE week_start_date < ?').bind(weekStart).run()
  return result.meta.changes
}

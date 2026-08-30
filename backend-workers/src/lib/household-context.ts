import { eq } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { householdMembers } from '../db/schema'

/**
 * ユーザーが所属する世帯グループIDを解決する。未所属の場合はnullを返す
 * (呼び出し側で404レスポンスに変換する。既存Javaの各ServiceのresolvehouseholdId相当)。
 */
export async function resolveHouseholdId(db: DrizzleD1Database, userId: number): Promise<number | null> {
  const membership = await db.select().from(householdMembers).where(eq(householdMembers.userId, userId)).get()
  return membership?.householdId ?? null
}

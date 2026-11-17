// デモ環境(#532)の共通処理。DEMO_MODE が "true" の環境だけで働く。

/** デモの寿命(作成からの時間)。 */
export const DEMO_LIFETIME_HOURS = 24
/** 同時に存在できるデモ世帯の上限。 */
export const DEMO_MAX_ACTIVE = 300

/** デモ環境か。"true" のときだけ true(未設定・他の値は本番として扱う)。 */
export function isDemoMode(env: { DEMO_MODE?: string }): boolean {
  // 環境(env)を渡さずに app.request を呼ぶテストでも落ちないよう、undefined を許す。
  return env?.DEMO_MODE === 'true'
}

export interface DemoMembership {
  householdId: number
  primaryUserId: number
  partnerUserId: number
  expiresAt: string
}

/** 利用者がデモ太郎・デモ花子のどちらかなら、そのデモ世帯の行を返す。通常の利用者は null。 */
export async function findDemoMembership(db: D1Database, userId: number): Promise<DemoMembership | null> {
  return db
    .prepare(
      `SELECT household_id AS householdId, primary_user_id AS primaryUserId, partner_user_id AS partnerUserId, expires_at AS expiresAt
       FROM demo_households WHERE primary_user_id = ?1 OR partner_user_id = ?1`,
    )
    .bind(userId)
    .first<DemoMembership>()
}

/** 利用者が期限切れのデモ利用者か。 */
export async function isExpiredDemoUser(db: D1Database, userId: number, now: Date): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS expired FROM demo_households WHERE (primary_user_id = ?1 OR partner_user_id = ?1) AND expires_at <= ?2')
    .bind(userId, now.toISOString())
    .first()
  return row !== null
}

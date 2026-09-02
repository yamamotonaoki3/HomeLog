// F-04 割り勘・精算管理: 精算確定時に家計簿へ自動記録するためのユーティリティ。

export const SETTLEMENT_CATEGORY_NAME = '割り勘精算'

/**
 * 世帯の「割り勘精算」デフォルトカテゴリーのIDを返す。存在しなければ冪等に作成する。
 *
 * kakeibo-categories.ts / income-categories.ts の DEFAULT_CATEGORY_NAMES にも含めているため
 * カテゴリー一覧を開けばシードされるが、精算(confirm-receipt)は一覧を一度も開いていない世帯でも
 * 起こりうるので、ここでも `INSERT ... WHERE NOT EXISTS` で確実に用意してからSELECTする。
 */
export async function ensureSettlementCategoryId(
  db: D1Database,
  householdId: number,
  kind: 'expense' | 'income',
): Promise<number> {
  const table = kind === 'expense' ? 'kakeibo_categories' : 'income_categories'
  await db
    .prepare(
      `INSERT INTO ${table} (household_id, name, is_default)
       SELECT ?, ?, 1
       WHERE NOT EXISTS (
         SELECT 1 FROM ${table} WHERE household_id = ? AND name = ? AND is_default = 1
       )`,
    )
    .bind(householdId, SETTLEMENT_CATEGORY_NAME, householdId, SETTLEMENT_CATEGORY_NAME)
    .run()

  const row = await db
    .prepare(`SELECT id FROM ${table} WHERE household_id = ? AND name = ? AND is_default = 1`)
    .bind(householdId, SETTLEMENT_CATEGORY_NAME)
    .first<{ id: number }>()
  if (!row) {
    throw new Error('割り勘精算カテゴリーの解決に失敗しました')
  }
  return row.id
}

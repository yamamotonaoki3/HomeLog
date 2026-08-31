import { fixedCosts } from '../db/schema'

const FIXED_COST_CATEGORY_NAME = '固定費'

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed')
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}

/** 対象日の「月末日」を算出する(既存Javaのtoday.lengthOfMonth()と同じ)。 */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * 世帯に「固定費」カテゴリーが存在しなければ冪等にシードし、そのIDを返す
 * (既存Javaの KakeiboCategoryService.resolveDefaultCategoryId と同じ挙動。
 * ドキュメント上は「未シードならエラー」とされているが、実装は自動シードして処理を継続する。
 * この食い違いはdocs/TypeScript移行時の要確認事項.mdに記録済み)。
 */
async function resolveFixedCostCategoryId(db: D1Database, householdId: number): Promise<number> {
  await db
    .prepare(
      `INSERT INTO kakeibo_categories (household_id, name, is_default)
       SELECT ?, ?, 1
       WHERE NOT EXISTS (
         SELECT 1 FROM kakeibo_categories WHERE household_id = ? AND name = ? AND is_default = 1
       )`,
    )
    .bind(householdId, FIXED_COST_CATEGORY_NAME, householdId, FIXED_COST_CATEGORY_NAME)
    .run()
  const category = await db
    .prepare('SELECT id FROM kakeibo_categories WHERE household_id = ? AND name = ?')
    .bind(householdId, FIXED_COST_CATEGORY_NAME)
    .first<{ id: number }>()
  if (!category) {
    throw new Error(`固定費カテゴリーのシードに失敗しました。householdId=${householdId}`)
  }
  return category.id
}

/**
 * 1件の固定費を、指定日を計上日として計上する(既存Javaの FixedCostPostingExecutor.postSingleFixedCost
 * と同じロジック)。二重計上防止はUNIQUE制約(fixed_cost_id, fixed_cost_year_month)に委ねる。
 */
async function postSingleFixedCost(db: D1Database, fixedCost: typeof fixedCosts.$inferSelect, today: Date): Promise<void> {
  const year = today.getUTCFullYear()
  const month = today.getUTCMonth() + 1
  const yearMonth = `${year}-${pad2(month)}`
  const expenseDate = `${yearMonth}-${pad2(today.getUTCDate())}`

  const alreadyPosted = await db
    .prepare('SELECT 1 FROM expenses WHERE fixed_cost_id = ? AND fixed_cost_year_month = ?')
    .bind(fixedCost.id, yearMonth)
    .first()
  if (alreadyPosted) {
    return
  }

  const categoryId = await resolveFixedCostCategoryId(db, fixedCost.householdId)

  // 実際に支出行へ設定するaccount_id/card_id。creditカードの場合は親口座から引き落とすため
  // account_idに親口座IDを設定しcard_idはNULLのまま(既存Java実装のpostWithCardと同じ)。
  let resolvedAccountId: number | null = null
  let resolvedCardId: number | null = null
  let balanceUpdateStatement: { table: 'accounts' | 'cards'; id: number } | null = null

  if (fixedCost.cardId != null) {
    const card = await db.prepare('SELECT id, account_id, card_type FROM cards WHERE id = ?').bind(fixedCost.cardId).first<{
      id: number
      account_id: number
      card_type: string
    }>()
    if (!card) {
      // 引き落とし元のカードが削除済み。既存Java実装はIllegalStateExceptionを投げて
      // このアイテムの計上を中断しつつ他アイテムの計上は継続する(呼び出し側でcatch)。
      throw new Error(`引き落とし元のカードが見つかりません。cardId=${fixedCost.cardId}`)
    }
    if (card.card_type === 'charge') {
      resolvedCardId = fixedCost.cardId
      balanceUpdateStatement = { table: 'cards', id: fixedCost.cardId }
    } else {
      resolvedAccountId = card.account_id
      balanceUpdateStatement = { table: 'accounts', id: card.account_id }
    }
  } else if (fixedCost.accountId != null) {
    resolvedAccountId = fixedCost.accountId
    balanceUpdateStatement = { table: 'accounts', id: fixedCost.accountId }
  }

  const statements = [
    db
      .prepare(
        `INSERT INTO expenses
           (household_id, payer_user_id, category_id, account_id, card_id, fixed_cost_id, fixed_cost_year_month,
            amount, purpose, expense_date, include_in_household_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        fixedCost.householdId,
        fixedCost.createdByUserId,
        categoryId,
        resolvedAccountId,
        resolvedCardId,
        fixedCost.id,
        yearMonth,
        fixedCost.amount,
        fixedCost.name,
        expenseDate,
        fixedCost.includeInHouseholdTotal ? 1 : 0,
      ),
  ]
  if (balanceUpdateStatement) {
    statements.push(
      db.prepare(`UPDATE ${balanceUpdateStatement.table} SET balance = balance - ? WHERE id = ?`).bind(fixedCost.amount, balanceUpdateStatement.id),
    )
  }

  try {
    await db.batch(statements)
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      // 他のインスタンス(または並行実行)が同じ固定費の当月分を先に計上済み。
      return
    }
    throw error
  }
}

/**
 * 指定日を基準に、当日が支払日にあたる固定費を全世帯分計上する(既存Javaの
 * FixedCostPostingService.postForDate + @Scheduled(cron = "0 0 1 * * *", zone = "Asia/Tokyo")相当)。
 * Cloudflare WorkersのCron Triggerから呼び出すことを想定し、日付はJST基準で呼び出し側が算出して渡す。
 */
export async function postDueFixedCosts(db: D1Database, today: Date): Promise<void> {
  const day = today.getUTCDate()
  const lastDay = lastDayOfMonth(today.getUTCFullYear(), today.getUTCMonth() + 1)

  const dueRows = await db
    .prepare(
      `SELECT * FROM fixed_costs
       WHERE payment_day = ?
          OR (payment_day > ? AND ? = ?)
       ORDER BY id`,
    )
    .bind(day, lastDay, day, lastDay)
    .all<{
      id: number
      household_id: number
      owner_user_id: number | null
      created_by_user_id: number
      account_id: number | null
      card_id: number | null
      name: string
      amount: number
      payment_day: number
      include_in_household_total: number
      created_at: string
    }>()

  for (const row of dueRows.results) {
    const fixedCost: typeof fixedCosts.$inferSelect = {
      id: row.id,
      householdId: row.household_id,
      ownerUserId: row.owner_user_id,
      createdByUserId: row.created_by_user_id,
      accountId: row.account_id,
      cardId: row.card_id,
      name: row.name,
      amount: row.amount,
      paymentDay: row.payment_day,
      includeInHouseholdTotal: Boolean(row.include_in_household_total),
      createdAt: row.created_at,
    }
    try {
      // 1件の失敗が他の世帯の計上を妨げないよう、意図的に直列実行する。
      await postSingleFixedCost(db, fixedCost, today)
    } catch (error) {
      // 既存Java実装と同じく、1件の計上失敗をログに記録して処理を継続する(他世帯の計上には影響させない)。
      console.error(`固定費の自動計上に失敗しました。fixedCostId=${fixedCost.id}`, error)
    }
  }
}

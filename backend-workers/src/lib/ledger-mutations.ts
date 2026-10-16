import type { Context } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import { resolveHouseholdId } from './household-context'
import { errorResponse } from './errors'
import type { AppEnv } from '../index'

export interface LedgerRow {
  id: number
  amount: number
  account_id: number | null
  card_id?: number | null
  fixed_cost_id?: number | null
  fixed_cost_year_month?: string | null
  settlement_split_id: number | null
}
export interface BalanceTarget { table: 'accounts' | 'cards'; id: number }
// 読み込み時の金額・補正先と一致する場合だけ更新する。同時に別の編集・削除が先に確定していれば
// 条件が成立せず、残高補正も本体の変更も行われない(古い値で二重に補正しない)。
export function ledgerWhere(kind: 'expenses' | 'incomes') {
  return `id = ? AND household_id = ? AND ${kind === 'expenses' ? 'payer' : 'earner'}_user_id = ?
    AND amount = ? AND account_id IS ? ${kind === 'expenses' ? 'AND card_id IS ?' : ''}
    AND settlement_split_id IS NULL ${kind === 'expenses' ? "AND NOT EXISTS (SELECT 1 FROM expense_splits WHERE expense_id = expenses.id AND status <> 'unpaid')" : ''}`
}
export function ledgerArgs(kind: 'expenses' | 'incomes', row: LedgerRow, householdId: number, userId: number) {
  return kind === 'expenses'
    ? [row.id, householdId, userId, row.amount, row.account_id, row.card_id ?? null]
    : [row.id, householdId, userId, row.amount, row.account_id]
}
export const conflict = (c: Context<AppEnv>, message = '対象の収入・支出が変更されました。再取得してください') =>
  c.json(errorResponse('RESOURCE_CONFLICT', message), 409)

/** 認証middleware→世帯→本人の対象→変更可否。本文の読み取りはこの後。 */
export async function loadMutableLedger(c: Context<AppEnv>, kind: 'expenses' | 'incomes') {
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(drizzle(c.env.DB), userId)
  if (householdId === null) return { error: c.json(errorResponse('RESOURCE_NOT_FOUND', '世帯グループが見つかりません'), 404) }
  const id = Number(c.req.param('id'))
  const row = Number.isSafeInteger(id) && id > 0 ? await c.env.DB.prepare(
    `SELECT * FROM ${kind} WHERE id = ? AND household_id = ? AND ${kind === 'expenses' ? 'payer' : 'earner'}_user_id = ?`,
  ).bind(id, householdId, userId).first<LedgerRow>() : null
  if (!row) return { error: c.json(errorResponse('RESOURCE_NOT_FOUND', kind === 'expenses' ? '支出が見つかりません' : '収入が見つかりません'), 404) }
  if (row.settlement_split_id !== null) return { error: conflict(c, '割り勘精算で自動作成された収入・支出は編集・削除できません') }
  if (kind === 'expenses' && await c.env.DB.prepare("SELECT 1 FROM expense_splits WHERE expense_id = ? AND status <> 'unpaid'").bind(id).first()) {
    return { error: conflict(c, '未請求以外の割り勘内訳がある支出は編集・削除できません') }
  }
  let target: BalanceTarget | null = null
  if (row.card_id != null) {
    const card = await c.env.DB.prepare(`SELECT c.id FROM cards c JOIN accounts a ON a.id = c.account_id
      WHERE c.id = ? AND a.household_id = ? AND a.owner_user_id = ? AND a.deleted_at IS NULL`)
      .bind(row.card_id, householdId, userId).first()
    if (!card) return { error: conflict(c, '残高の補正先を確認できないため編集・削除できません') }
    target = { table: 'cards', id: row.card_id }
  } else if (row.account_id != null) {
    const account = await c.env.DB.prepare('SELECT id FROM accounts WHERE id = ? AND household_id = ? AND owner_user_id = ? AND deleted_at IS NULL')
      .bind(row.account_id, householdId, userId).first()
    if (!account) return { error: conflict(c, kind === 'incomes' ? '削除済みの口座に入金した収入は編集・削除できません' : '残高の補正先を確認できないため編集・削除できません') }
    target = { table: 'accounts', id: row.account_id }
  }
  return { row, target, householdId, userId }
}

/** 同じ先への補正は差額の相対UPDATE一回。全て本体変更と同じbatchで実行する。 */
export function balanceStatements(db: D1Database, oldTarget: BalanceTarget | null, oldDelta: number,
  newTarget: BalanceTarget | null = null, newDelta = 0, condition = '', bindings: unknown[] = []) {
  const deltas = new Map<string, { target: BalanceTarget; delta: number }>()
  for (const [target, delta] of [[oldTarget, oldDelta], [newTarget, newDelta]] as const) {
    if (!target) continue
    const key = `${target.table}:${target.id}`
    deltas.set(key, { target, delta: (deltas.get(key)?.delta ?? 0) + delta })
  }
  return [...deltas.values()].filter(({delta}) => delta !== 0).map(({target,delta}) => db.prepare(
    `UPDATE ${target.table} SET balance = balance + ? WHERE id = ? ${condition ? `AND (${condition})` : ''}`,
  ).bind(delta, target.id, ...bindings))
}

export async function deleteLedger(c: Context<AppEnv>, kind: 'expenses' | 'incomes') {
  const ctx = await loadMutableLedger(c, kind)
  if (ctx.error) return ctx.error
  const { row, target, householdId, userId } = ctx
  const args = ledgerArgs(kind, row, householdId, userId)
  const exists = `EXISTS (SELECT 1 FROM ${kind} WHERE ${ledgerWhere(kind)})`
  const statements = balanceStatements(c.env.DB, target, kind === 'expenses' ? row.amount : -row.amount, null, 0, exists, args)
  if (kind === 'expenses' && row.fixed_cost_id != null && row.fixed_cost_year_month != null) {
    statements.push(c.env.DB.prepare(`INSERT OR IGNORE INTO fixed_cost_posting_suppressions (fixed_cost_id, year_month)
      SELECT fixed_cost_id, fixed_cost_year_month FROM expenses WHERE ${ledgerWhere(kind)}`).bind(...args))
  }
  statements.push(c.env.DB.prepare(`DELETE FROM ${kind} WHERE ${ledgerWhere(kind)} RETURNING id`).bind(...args))
  const results = await c.env.DB.batch(statements)
  if (results[results.length - 1].results.length === 0) return conflict(c)
  return c.body(null, 204)
}

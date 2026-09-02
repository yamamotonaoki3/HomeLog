import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'
import { errorResponse } from '../lib/errors'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'
const NOT_FOUND_MESSAGE = '割り勘の内訳が見つかりません'
const INVALID_STATUS_MESSAGE = '現在の状態ではこの操作はできません'

// 割り勘内訳の状態遷移(F04_kakeibo_warikan.md 3章の業務フロー)。
// unpaid → requested → approval_requested → settled、いつでも pending へ退避できる。
// 世帯外の非利用者(debtor_external_id あり)は支払者の自己申告のみで settled にできる。

interface SplitRow {
  id: number
  expense_id: number
  debtor_user_id: number | null
  debtor_external_id: number | null
  split_input_type: string
  split_ratio: number
  amount_due: number
  status: string
  requested_at: string | null
  settled_at: string | null
  expense_purpose: string
  expense_amount: number
  expense_date: string
  payer_user_id: number
  payer_name: string
  debtor_user_name: string | null
  debtor_external_name: string | null
}

async function loadSplit(
  db: D1Database,
  householdId: number,
  splitId: number,
): Promise<SplitRow | null> {
  const row = await db
    .prepare(
      `SELECT s.id, s.expense_id, s.debtor_user_id, s.debtor_external_id, s.split_input_type,
              s.split_ratio, s.amount_due, s.status, s.requested_at, s.settled_at,
              e.purpose AS expense_purpose, e.amount AS expense_amount, e.expense_date, e.payer_user_id,
              payer.display_name AS payer_name,
              debtor.display_name AS debtor_user_name,
              ext.name AS debtor_external_name
         FROM expense_splits s
         JOIN expenses e ON e.id = s.expense_id
         JOIN users payer ON payer.id = e.payer_user_id
         LEFT JOIN users debtor ON debtor.id = s.debtor_user_id
         LEFT JOIN external_persons ext ON ext.id = s.debtor_external_id
        WHERE s.id = ? AND e.household_id = ?`,
    )
    .bind(splitId, householdId)
    .first<SplitRow>()
  return row ?? null
}

function toResponse(row: SplitRow, userId: number) {
  const role: 'payer' | 'debtor' = row.payer_user_id === userId ? 'payer' : 'debtor'
  return {
    id: row.id,
    expenseId: row.expense_id,
    expensePurpose: row.expense_purpose,
    expenseAmount: row.expense_amount,
    expenseDate: row.expense_date,
    role,
    isExternal: row.debtor_external_id != null,
    payerLabel: row.payer_name,
    debtorLabel: row.debtor_user_name ?? row.debtor_external_name ?? '(不明)',
    splitInputType: row.split_input_type,
    splitRatio: row.split_ratio,
    amountDue: row.amount_due,
    status: row.status,
    requestedAt: row.requested_at,
    settledAt: row.settled_at,
  }
}

export const expenseSplitsRoute = new Hono<AppEnv>()

expenseSplitsRoute.use('*', requireAuth)

expenseSplitsRoute.get('/', async (c) => {
  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  // 自世帯かつ「自分が支払者 or 自分が負担者」の内訳のみ返す(個人の家計簿情報の可視範囲。
  // common-notes.md 2章。第三者には他人の割り勘は見えない)。
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.expense_id, s.debtor_user_id, s.debtor_external_id, s.split_input_type,
            s.split_ratio, s.amount_due, s.status, s.requested_at, s.settled_at,
            e.purpose AS expense_purpose, e.amount AS expense_amount, e.expense_date, e.payer_user_id,
            payer.display_name AS payer_name,
            debtor.display_name AS debtor_user_name,
            ext.name AS debtor_external_name
       FROM expense_splits s
       JOIN expenses e ON e.id = s.expense_id
       JOIN users payer ON payer.id = e.payer_user_id
       LEFT JOIN users debtor ON debtor.id = s.debtor_user_id
       LEFT JOIN external_persons ext ON ext.id = s.debtor_external_id
      WHERE e.household_id = ? AND (e.payer_user_id = ? OR s.debtor_user_id = ?)
      ORDER BY s.id DESC`,
  )
    .bind(householdId, userId, userId)
    .all<SplitRow>()

  return c.json(results.map((row) => toResponse(row, userId)))
})

// 状態遷移の共通処理。role(支払者/負担者)と現在statusを検証し、UPDATE後の行を返す。
type Actor = 'payer' | 'debtor'

function transition(
  path: string,
  actor: Actor,
  allowedFrom: string[],
  buildUpdate: () => { setClause: string; nextStatus: string },
  options: { externalOnly?: boolean } = {},
) {
  expenseSplitsRoute.patch(`/:id/${path}`, async (c) => {
    const splitId = Number(c.req.param('id'))
    const db = drizzle(c.env.DB)
    const userId = c.get('userId')
    const householdId = await resolveHouseholdId(db, userId)
    if (householdId === null) {
      return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
    }

    const split = await loadSplit(c.env.DB, householdId, splitId)
    if (!split) {
      return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
    }

    // ロール判定。権限が無い操作は存在しないIDと同じ404で返す(common-notes.md 10章、IDOR対策)。
    const isPayer = split.payer_user_id === userId
    const isDebtor = split.debtor_user_id != null && split.debtor_user_id === userId
    if ((actor === 'payer' && !isPayer) || (actor === 'debtor' && !isDebtor)) {
      return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
    }
    if (options.externalOnly && split.debtor_external_id == null) {
      return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
    }

    if (!allowedFrom.includes(split.status)) {
      return c.json(errorResponse('VALIDATION_ERROR', INVALID_STATUS_MESSAGE), 400)
    }

    const { setClause, nextStatus } = buildUpdate()
    await c.env.DB.prepare(`UPDATE expense_splits SET ${setClause} WHERE id = ?`).bind(splitId).run()

    const updated = await loadSplit(c.env.DB, householdId, splitId)
    return c.json(toResponse(updated ?? { ...split, status: nextStatus }, userId))
  })
}

// 請求(支払者): unpaid / pending → requested
transition('request', 'payer', ['unpaid', 'pending'], () => ({
  setClause: "status = 'requested', requested_at = COALESCE(requested_at, CURRENT_TIMESTAMP)",
  nextStatus: 'requested',
}))

// 受領申請(支払者): requested / pending → approval_requested
transition('receipt-request', 'payer', ['requested', 'pending'], () => ({
  setClause: "status = 'approval_requested'",
  nextStatus: 'approval_requested',
}))

// 承認=精算確定(負担者): approval_requested → settled
transition('approve', 'debtor', ['approval_requested'], () => ({
  setClause: "status = 'settled', settled_at = CURRENT_TIMESTAMP",
  nextStatus: 'settled',
}))

// 保留(負担者): requested / approval_requested → pending
transition('hold', 'debtor', ['requested', 'approval_requested'], () => ({
  setClause: "status = 'pending'",
  nextStatus: 'pending',
}))

// 自己申告で精算済み(支払者、相手が世帯外の非利用者のときのみ): 非settled → settled
transition(
  'settle-self',
  'payer',
  ['unpaid', 'requested', 'approval_requested', 'pending'],
  () => ({ setClause: "status = 'settled', settled_at = CURRENT_TIMESTAMP", nextStatus: 'settled' }),
  { externalOnly: true },
)

expenseSplitsRoute.delete('/:id', async (c) => {
  const splitId = Number(c.req.param('id'))
  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const split = await loadSplit(c.env.DB, householdId, splitId)
  if (!split || split.payer_user_id !== userId) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  await c.env.DB.prepare('DELETE FROM expense_splits WHERE id = ?').bind(splitId).run()
  return c.body(null, 204)
})

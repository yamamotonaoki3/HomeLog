import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { formatJstToday } from '../lib/date'
import { errorResponse } from '../lib/errors'
import { resolveHouseholdId } from '../lib/household-context'
import { ensureSettlementCategoryId } from '../lib/settlement'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'
const NOT_FOUND_MESSAGE = '割り勘の内訳が見つかりません'
const INVALID_STATUS_MESSAGE = '現在の状態ではこの操作はできません'
const INVALID_ACCOUNT_MESSAGE = '指定された口座が見つかりません'
const SETTLED_NOT_DELETABLE_MESSAGE = '精算済みの割り勘内訳は削除できません'

// 割り勘内訳の状態遷移(F04_kakeibo_warikan.md 3章の業務フロー)。
//   unpaid(未請求) → requested(請求中、立替者が請求) → payment_reported(負担者が「支払った」と報告)
//   → settled(立替者が「受け取った」で確定)。いつでも pending へ退避できる。
// 世帯外の非利用者(debtor_external_id あり)は立替者の自己申告(settle-self)のみで settled にできる。
// 精算確定時(confirm-receipt / settle-self)に、立替者へ収入・負担者へ支出を家計簿へ自動記録し、
// 選択された口座があれば残高も増減させる。

const NON_SETTLED_STATUSES = ['unpaid', 'requested', 'payment_reported', 'pending']

// accountId は任意。ボディ無しでも呼べる。
const accountBodySchema = z.object({ accountId: z.number().int().positive().nullish() })

const commentBodySchema = z.object({
  body: z.string().trim().min(1, '本文を入力してください').max(500, '本文は500文字以内で入力してください'),
})

async function parseJsonBody(c: Context): Promise<unknown> {
  try {
    return (await c.req.json()) ?? {}
  } catch {
    return {}
  }
}

interface SplitRow {
  id: number
  expense_id: number
  debtor_user_id: number | null
  debtor_external_id: number | null
  debtor_account_id: number | null
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

const SPLIT_SELECT = `SELECT s.id, s.expense_id, s.debtor_user_id, s.debtor_external_id, s.debtor_account_id,
        s.split_input_type, s.split_ratio, s.amount_due, s.status, s.requested_at, s.settled_at,
        e.purpose AS expense_purpose, e.amount AS expense_amount, e.expense_date, e.payer_user_id,
        payer.display_name AS payer_name,
        debtor.display_name AS debtor_user_name,
        ext.name AS debtor_external_name
   FROM expense_splits s
   JOIN expenses e ON e.id = s.expense_id
   JOIN users payer ON payer.id = e.payer_user_id
   LEFT JOIN users debtor ON debtor.id = s.debtor_user_id
   LEFT JOIN external_persons ext ON ext.id = s.debtor_external_id`

async function loadSplit(db: D1Database, householdId: number, splitId: number): Promise<SplitRow | null> {
  const row = await db
    .prepare(`${SPLIT_SELECT} WHERE s.id = ? AND e.household_id = ?`)
    .bind(splitId, householdId)
    .first<SplitRow>()
  return row ?? null
}

async function accountOwnedBy(db: D1Database, accountId: number, ownerUserId: number, householdId: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM accounts WHERE id = ? AND owner_user_id = ? AND household_id = ?')
    .bind(accountId, ownerUserId, householdId)
    .first()
  return row != null
}

// コメント投稿者は必ずその内訳の立替者 or 負担者(世帯外の負担者はログインできず投稿不可)なので、
// 追加JOINせずに SplitRow が既に持つ payer_name / debtor_user_name から解決できる。
function authorLabelFor(split: SplitRow, authorUserId: number): string {
  return authorUserId === split.payer_user_id ? split.payer_name : (split.debtor_user_name ?? '(不明)')
}

function toCommentResponse(split: SplitRow, row: { id: number; author_user_id: number; body: string; created_at: string }) {
  return {
    id: row.id,
    authorUserId: row.author_user_id,
    authorLabel: authorLabelFor(split, row.author_user_id),
    authorRole: row.author_user_id === split.payer_user_id ? 'payer' : 'debtor',
    body: row.body,
    createdAt: row.created_at,
  }
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
    // 支払い元口座は負担者本人にしか返さない(他人の口座IDを露出させない)。
    debtorAccountId: role === 'debtor' ? row.debtor_account_id : null,
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

  // 自世帯かつ「自分が立替者 or 自分が負担者」の内訳のみ返す(個人の家計簿情報の可視範囲。
  // common-notes.md 2章。第三者には他人の割り勘は見えない)。
  const { results } = await c.env.DB.prepare(
    `${SPLIT_SELECT} WHERE e.household_id = ? AND (e.payer_user_id = ? OR s.debtor_user_id = ?) ORDER BY s.id DESC`,
  )
    .bind(householdId, userId, userId)
    .all<SplitRow>()

  // コメント件数バッジ用。N+1を避けるため対象split群をまとめて1クエリでCOUNTする。
  const commentCounts = new Map<number, number>()
  if (results.length > 0) {
    const placeholders = results.map(() => '?').join(', ')
    const { results: countRows } = await c.env.DB.prepare(
      `SELECT expense_split_id, COUNT(*) AS cnt FROM expense_split_comments
       WHERE expense_split_id IN (${placeholders}) GROUP BY expense_split_id`,
    )
      .bind(...results.map((row) => row.id))
      .all<{ expense_split_id: number; cnt: number }>()
    for (const row of countRows) commentCounts.set(row.expense_split_id, row.cnt)
  }

  return c.json(results.map((row) => ({ ...toResponse(row, userId), commentCount: commentCounts.get(row.id) ?? 0 })))
})

// ---- ロール・status の共通チェック ----
type Actor = 'payer' | 'debtor'

type ActorContext =
  | { error: Response }
  | { error?: undefined; split: SplitRow; splitId: number; householdId: number; userId: number }

async function resolveActorContext(
  c: Context<AppEnv>,
  actor: Actor,
  allowedFrom: string[],
  options: { externalOnly?: boolean } = {},
): Promise<ActorContext> {
  const splitId = Number(c.req.param('id'))
  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return { error: c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404) }
  }
  const split = await loadSplit(c.env.DB, householdId, splitId)
  if (!split) {
    return { error: c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404) }
  }
  // 権限が無い操作は存在しないIDと同じ404で返す(common-notes.md 10章、IDOR対策)。
  const isPayer = split.payer_user_id === userId
  const isDebtor = split.debtor_user_id != null && split.debtor_user_id === userId
  if ((actor === 'payer' && !isPayer) || (actor === 'debtor' && !isDebtor)) {
    return { error: c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404) }
  }
  if (options.externalOnly && split.debtor_external_id == null) {
    return { error: c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404) }
  }
  if (!allowedFrom.includes(split.status)) {
    return { error: c.json(errorResponse('VALIDATION_ERROR', INVALID_STATUS_MESSAGE), 400) }
  }
  return { split, splitId, householdId, userId }
}

// ---- コメント用: 立替者 or 負担者どちらでもよい権限チェック ----
// resolveActorContext は単一ロール固定+status制限付きなので、コメントには使えない
// (statusを問わず、立替者・負担者どちらも閲覧・投稿可能にするため)。
type ParticipantContext =
  | { error: Response }
  | { error?: undefined; split: SplitRow; splitId: number; userId: number }

async function loadSplitForParticipant(c: Context<AppEnv>): Promise<ParticipantContext> {
  const splitId = Number(c.req.param('id'))
  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return { error: c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404) }
  }
  const split = await loadSplit(c.env.DB, householdId, splitId)
  if (!split) {
    return { error: c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404) }
  }
  const isPayer = split.payer_user_id === userId
  const isDebtor = split.debtor_user_id != null && split.debtor_user_id === userId
  if (!isPayer && !isDebtor) {
    // 第三者には存在しないIDと同じ404を返す(common-notes.md 10章、IDOR対策)。
    return { error: c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404) }
  }
  return { split, splitId, userId }
}

expenseSplitsRoute.get('/:id/comments', async (c) => {
  const ctx = await loadSplitForParticipant(c)
  if (ctx.error) return ctx.error
  const { split, splitId } = ctx

  const { results } = await c.env.DB.prepare(
    'SELECT id, author_user_id, body, created_at FROM expense_split_comments WHERE expense_split_id = ? ORDER BY id ASC',
  )
    .bind(splitId)
    .all<{ id: number; author_user_id: number; body: string; created_at: string }>()

  return c.json(results.map((row) => toCommentResponse(split, row)))
})

expenseSplitsRoute.post('/:id/comments', async (c) => {
  const parsed = commentBodySchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '入力内容を確認してください'), 400)
  }
  const ctx = await loadSplitForParticipant(c)
  if (ctx.error) return ctx.error
  const { split, splitId, userId } = ctx

  const insertResult = await c.env.DB.prepare('INSERT INTO expense_split_comments (expense_split_id, author_user_id, body) VALUES (?, ?, ?)')
    .bind(splitId, userId, parsed.data.body)
    .run()
  const row = await c.env.DB.prepare('SELECT id, author_user_id, body, created_at FROM expense_split_comments WHERE id = ?')
    .bind(insertResult.meta.last_row_id)
    .first<{ id: number; author_user_id: number; body: string; created_at: string }>()

  return c.json(toCommentResponse(split, row!), 201)
})

// ---- ボディ不要の単純遷移(請求・保留) ----
function simpleTransition(path: string, actor: Actor, allowedFrom: string[], setClause: string) {
  expenseSplitsRoute.patch(`/:id/${path}`, async (c) => {
    const ctx = await resolveActorContext(c, actor, allowedFrom)
    if (ctx.error) return ctx.error
    const { splitId, householdId, userId } = ctx

    // 遷移元statusをUPDATEのWHERE句にも含め、更新行数0なら競合とみなして400(行ロックの無いD1対策)。
    const placeholders = allowedFrom.map(() => '?').join(', ')
    const updateResult = await c.env.DB
      .prepare(`UPDATE expense_splits SET ${setClause} WHERE id = ? AND status IN (${placeholders})`)
      .bind(splitId, ...allowedFrom)
      .run()
    if (updateResult.meta.changes === 0) {
      return c.json(errorResponse('VALIDATION_ERROR', INVALID_STATUS_MESSAGE), 400)
    }

    const updated = await loadSplit(c.env.DB, householdId, splitId)
    return c.json(toResponse(updated!, userId))
  })
}

// 請求(立替者): unpaid / pending / payment_reported → requested
// payment_reported からの請求は「まだ受け取っていない」という差し戻しの意味。
simpleTransition('request', 'payer', ['unpaid', 'pending', 'payment_reported'],
  "status = 'requested', requested_at = COALESCE(requested_at, CURRENT_TIMESTAMP)")

// 保留(負担者): requested / payment_reported → pending
simpleTransition('hold', 'debtor', ['requested', 'payment_reported'], "status = 'pending'")

// ---- 支払報告(負担者): unpaid / requested / pending → payment_reported ----
// 負担者が「支払った」時点で支払い元口座(任意)を内訳行に保持する。家計簿への記録は精算確定時。
expenseSplitsRoute.patch('/:id/mark-paid', async (c) => {
  const parsed = accountBodySchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const ctx = await resolveActorContext(c, 'debtor', ['unpaid', 'requested', 'pending'])
  if (ctx.error) return ctx.error
  const { splitId, householdId, userId } = ctx

  const accountId = parsed.data.accountId ?? null
  if (accountId != null && !(await accountOwnedBy(c.env.DB, accountId, userId, householdId))) {
    return c.json(errorResponse('VALIDATION_ERROR', INVALID_ACCOUNT_MESSAGE), 400)
  }

  const updateResult = await c.env.DB
    .prepare(
      `UPDATE expense_splits SET status = 'payment_reported', debtor_account_id = ?
       WHERE id = ? AND status IN ('unpaid', 'requested', 'pending')`,
    )
    .bind(accountId, splitId)
    .run()
  if (updateResult.meta.changes === 0) {
    return c.json(errorResponse('VALIDATION_ERROR', INVALID_STATUS_MESSAGE), 400)
  }

  const updated = await loadSplit(c.env.DB, householdId, splitId)
  return c.json(toResponse(updated!, userId))
})

// ---- 精算確定時に家計簿へ自動記録するバッチを組み立てる ----
interface SettlementParams {
  householdId: number
  splitId: number
  amount: number
  payerUserId: number
  debtorUserId: number | null // null = 世帯外の非利用者(支出行は作らない)
  payerAccountId: number | null
  debtorAccountId: number | null
  purposeText: string
  incomeMemo: string
  expenseMemo: string
  incomeCategoryId: number
  expenseCategoryId: number
  date: string
  // バッチ内の各文が「精算前の状態のときだけ実行される」ための EXISTS 条件と、最後の status UPDATE。
  guardSql: string
  finalUpdateSql: string
}

function buildSettlementStatements(db: D1Database, p: SettlementParams): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    // 立替者の収入
    db
      .prepare(
        `INSERT INTO incomes (household_id, earner_user_id, category_id, account_id, amount, content, memo, income_date)
         SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${p.guardSql}`,
      )
      .bind(
        p.householdId,
        p.payerUserId,
        p.incomeCategoryId,
        p.payerAccountId,
        p.amount,
        p.purposeText,
        p.incomeMemo,
        p.date,
        p.splitId,
      ),
  ]

  if (p.debtorUserId != null) {
    // 負担者の支出。元の共同支出との二重計上を避けるため include_in_household_total = 0。
    statements.push(
      db
        .prepare(
          `INSERT INTO expenses (household_id, payer_user_id, category_id, account_id, amount, purpose, memo, expense_date, include_in_household_total)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, 0 WHERE ${p.guardSql}`,
        )
        .bind(
          p.householdId,
          p.debtorUserId,
          p.expenseCategoryId,
          p.debtorAccountId,
          p.amount,
          p.purposeText,
          p.expenseMemo,
          p.date,
          p.splitId,
        ),
    )
  }

  if (p.debtorAccountId != null) {
    statements.push(
      db.prepare(`UPDATE accounts SET balance = balance - ? WHERE id = ? AND ${p.guardSql}`).bind(p.amount, p.debtorAccountId, p.splitId),
    )
  }
  if (p.payerAccountId != null) {
    statements.push(
      db.prepare(`UPDATE accounts SET balance = balance + ? WHERE id = ? AND ${p.guardSql}`).bind(p.amount, p.payerAccountId, p.splitId),
    )
  }

  // 最後に status を settled へ。更新行数で成否を判定する(0 なら上のガード付き文もすべて no-op)。
  statements.push(db.prepare(p.finalUpdateSql).bind(p.splitId))
  return statements
}

async function runSettlement(
  c: Context<AppEnv>,
  ctx: { split: SplitRow; splitId: number; householdId: number; userId: number },
  kind: 'confirm-receipt' | 'settle-self',
  payerAccountId: number | null,
) {
  const { split, splitId, householdId, userId } = ctx
  const amount = split.amount_due
  const purposeText = split.expense_purpose?.trim() ? split.expense_purpose.trim() : '割り勘精算'
  const debtorLabel = split.debtor_user_name ?? split.debtor_external_name ?? '相手'

  // 負担者の支払い口座(mark-paid で保持済み)。口座が削除されていれば null 扱いで続行。
  let debtorAccountId = split.debtor_account_id
  if (debtorAccountId != null) {
    const exists = await c.env.DB.prepare('SELECT 1 FROM accounts WHERE id = ?').bind(debtorAccountId).first()
    if (!exists) debtorAccountId = null
  }

  const [incomeCategoryId, expenseCategoryId] = await Promise.all([
    ensureSettlementCategoryId(c.env.DB, householdId, 'income'),
    kind === 'confirm-receipt'
      ? ensureSettlementCategoryId(c.env.DB, householdId, 'expense')
      : Promise.resolve(0),
  ])

  const guardStatus = kind === 'confirm-receipt' ? "status = 'payment_reported'" : "status != 'settled'"
  const params: SettlementParams = {
    householdId,
    splitId,
    amount,
    payerUserId: split.payer_user_id,
    debtorUserId: kind === 'confirm-receipt' ? split.debtor_user_id : null,
    payerAccountId,
    debtorAccountId,
    purposeText,
    incomeMemo: `${debtorLabel} からの割り勘精算`,
    expenseMemo: `${split.payer_name} への割り勘精算`,
    incomeCategoryId,
    expenseCategoryId,
    date: formatJstToday(),
    guardSql: `EXISTS (SELECT 1 FROM expense_splits WHERE id = ? AND ${guardStatus})`,
    finalUpdateSql: `UPDATE expense_splits SET status = 'settled', settled_at = CURRENT_TIMESTAMP WHERE id = ? AND ${guardStatus}`,
  }

  const statements = buildSettlementStatements(c.env.DB, params)
  const results = await c.env.DB.batch(statements)
  const finalResult = results[results.length - 1]
  if (finalResult.meta.changes === 0) {
    return c.json(errorResponse('VALIDATION_ERROR', INVALID_STATUS_MESSAGE), 400)
  }

  const updated = await loadSplit(c.env.DB, householdId, splitId)
  return c.json(toResponse(updated!, userId))
}

// ---- 受領確定(立替者): payment_reported → settled ----
expenseSplitsRoute.patch('/:id/confirm-receipt', async (c) => {
  const parsed = accountBodySchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const ctx = await resolveActorContext(c, 'payer', ['payment_reported'])
  if (ctx.error) return ctx.error

  const payerAccountId = parsed.data.accountId ?? null
  if (payerAccountId != null && !(await accountOwnedBy(c.env.DB, payerAccountId, ctx.userId, ctx.householdId))) {
    return c.json(errorResponse('VALIDATION_ERROR', INVALID_ACCOUNT_MESSAGE), 400)
  }
  return runSettlement(c, ctx, 'confirm-receipt', payerAccountId)
})

// ---- 自己申告で精算済み(立替者、相手が世帯外の非利用者のときのみ): 非settled → settled ----
expenseSplitsRoute.patch('/:id/settle-self', async (c) => {
  const parsed = accountBodySchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const ctx = await resolveActorContext(c, 'payer', NON_SETTLED_STATUSES, { externalOnly: true })
  if (ctx.error) return ctx.error

  const payerAccountId = parsed.data.accountId ?? null
  if (payerAccountId != null && !(await accountOwnedBy(c.env.DB, payerAccountId, ctx.userId, ctx.householdId))) {
    return c.json(errorResponse('VALIDATION_ERROR', INVALID_ACCOUNT_MESSAGE), 400)
  }
  return runSettlement(c, ctx, 'settle-self', payerAccountId)
})

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
  // 精算済み(現金が動いた後)の内訳は消さない。未精算のもののみ削除可。
  if (split.status === 'settled') {
    return c.json(errorResponse('VALIDATION_ERROR', SETTLED_NOT_DELETABLE_MESSAGE), 400)
  }

  await c.env.DB.prepare('DELETE FROM expense_splits WHERE id = ?').bind(splitId).run()
  return c.body(null, 204)
})

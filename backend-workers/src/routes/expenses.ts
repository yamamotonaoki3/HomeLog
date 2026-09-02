import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { accounts, cards, events, expenses, externalPersons, householdMembers, kakeiboCategories } from '../db/schema'
import { isValidCalendarDate } from '../lib/date'
import { errorResponse } from '../lib/errors'
import { parseOptionalIntQueryParam } from '../lib/query-params'
import { resolveHouseholdId } from '../lib/household-context'
import { resolveSplits, type SplitInputRow } from '../lib/split-calc'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const CATEGORY_NOT_FOUND_MESSAGE = '指定されたカテゴリーが見つかりません'
const ACCOUNT_AND_CARD_BOTH_SPECIFIED_MESSAGE = '口座とカードは同時に指定できません'
const INVALID_ACCOUNT_MESSAGE = '指定された口座が見つかりません'
const INVALID_CARD_MESSAGE = '指定されたカードが見つかりません'
const INVALID_EVENT_MESSAGE = '指定されたイベントが見つかりません'
const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'
const INVALID_SPLIT_TARGET_MESSAGE = '割り勘の相手が正しくありません'
const SPLIT_ROW_IDENTITY_MESSAGE = '割り勘の相手は世帯メンバーか世帯外の人のどちらかを指定してください'
const SPLIT_DUPLICATE_MESSAGE = '同じ相手を複数回指定することはできません'
const SPLIT_PAYER_AS_DEBTOR_MESSAGE = '自分を割り勘の相手に指定することはできません'

const AMOUNT_MAX = 9_999_999_999

// 割り勘の相手(支払者以外)1人分。debtorUserId / debtorExternalId / debtorExternalName のいずれか1つだけを指定する。
// 支払者本人の負担分はリクエストに含めない(支出金額 - 相手の負担額合計 として暗黙に決まる)。
const splitRowSchema = z.object({
  debtorUserId: z.number().int().nullish(),
  debtorExternalId: z.number().int().nullish(),
  debtorExternalName: z.string().max(50).nullish(),
  ratio: z.number().nonnegative().max(100).nullish(),
  amountDue: z.number().int().nonnegative().max(AMOUNT_MAX).nullish(),
})

const createExpenseSchema = z.object({
  expenseDate: z.string().refine(isValidCalendarDate, { message: '日付の形式が不正です' }),
  amount: z.number().int().positive().max(AMOUNT_MAX),
  // 使用用途は任意(空欄可)。F03_kakeibo_expense.md 5章の通り 0〜100文字。
  purpose: z.string().max(100).nullish(),
  categoryId: z.number().int(),
  memo: z.string().max(255).nullish(),
  includeInHouseholdTotal: z.boolean().nullish(),
  accountId: z.number().int().nullish(),
  cardId: z.number().int().nullish(),
  eventId: z.number().int().nullish(),
  splitInputType: z.enum(['ratio', 'amount']).nullish(),
  splits: z.array(splitRowSchema).max(20).nullish(),
})

async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

function toResponse(expense: typeof expenses.$inferSelect) {
  return {
    id: expense.id,
    expenseDate: expense.expenseDate,
    amount: expense.amount,
    purpose: expense.purpose,
    categoryId: expense.categoryId,
    memo: expense.memo,
    includeInHouseholdTotal: expense.includeInHouseholdTotal,
    accountId: expense.accountId,
    cardId: expense.cardId,
    eventId: expense.eventId,
  }
}

interface PreparedSplit {
  debtorUserId: number | null
  debtorExternalId: number | null
  // 事前に external_persons へINSERTしてIDに解決する(バッチ前)。
  newExternalName: string | null
  splitInputType: 'ratio' | 'amount'
  splitRatio: number
  amountDue: number
}

type SplitRowInput = z.infer<typeof splitRowSchema>

/**
 * 支出登録リクエストの `splits`(支払者以外の割り勘の相手)を検証し、永続化する内訳行を確定する。
 * 支払者本人の負担分は「支出金額 - 相手の負担額合計」として暗黙に決まる(行は作らない)。
 * 世帯メンバーか否か・世帯外の相手が自世帯のものか、をDBで確認したうえで split-calc.ts に計算を委譲する。
 */
async function prepareSplits(
  db: ReturnType<typeof drizzle>,
  householdId: number,
  payerUserId: number,
  amount: number,
  splitInputType: 'ratio' | 'amount',
  splits: SplitRowInput[],
): Promise<{ ok: true; rows: PreparedSplit[] } | { ok: false; message: string }> {
  if (splits.length === 0) {
    return { ok: true, rows: [] }
  }

  const dedupeKeys = new Set<string>()
  const prepared: {
    key: string
    debtorUserId: number | null
    debtorExternalId: number | null
    newExternalName: string | null
    ratio?: number | null
    amountDue?: number | null
  }[] = []

  for (const row of splits) {
    const name = row.debtorExternalName?.trim() ? row.debtorExternalName.trim() : null
    const identityCount = Number(row.debtorUserId != null) + Number(row.debtorExternalId != null) + Number(name != null)
    if (identityCount !== 1) {
      return { ok: false, message: SPLIT_ROW_IDENTITY_MESSAGE }
    }
    // 支払者本人は暗黙の負担者。相手として明示指定させない。
    if (row.debtorUserId != null && row.debtorUserId === payerUserId) {
      return { ok: false, message: SPLIT_PAYER_AS_DEBTOR_MESSAGE }
    }

    let key: string
    if (row.debtorUserId != null) {
      key = `u:${row.debtorUserId}`
    } else if (row.debtorExternalId != null) {
      key = `e:${row.debtorExternalId}`
    } else {
      key = `n:${name!.toLowerCase()}`
    }
    if (dedupeKeys.has(key)) {
      return { ok: false, message: SPLIT_DUPLICATE_MESSAGE }
    }
    dedupeKeys.add(key)

    prepared.push({
      key,
      debtorUserId: row.debtorUserId ?? null,
      debtorExternalId: row.debtorExternalId ?? null,
      newExternalName: name,
      ratio: row.ratio,
      amountDue: row.amountDue,
    })
  }

  // 世帯メンバーであることの確認(debtorUserId)。
  const memberIds = prepared.filter((row) => row.debtorUserId != null).map((row) => row.debtorUserId!)
  for (const memberId of memberIds) {
    const membership = await db
      .select({ userId: householdMembers.userId })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, memberId)))
      .get()
    if (!membership) {
      return { ok: false, message: INVALID_SPLIT_TARGET_MESSAGE }
    }
  }

  // 世帯外の相手(既存)が自世帯のものであることの確認。
  const externalIds = prepared.filter((row) => row.debtorExternalId != null).map((row) => row.debtorExternalId!)
  for (const externalId of externalIds) {
    const person = await db
      .select({ id: externalPersons.id })
      .from(externalPersons)
      .where(and(eq(externalPersons.id, externalId), eq(externalPersons.householdId, householdId)))
      .get()
    if (!person) {
      return { ok: false, message: INVALID_SPLIT_TARGET_MESSAGE }
    }
  }

  const calcRows: SplitInputRow[] = prepared.map((row) => ({ key: row.key, ratio: row.ratio, amountDue: row.amountDue }))
  const result = resolveSplits(amount, splitInputType, calcRows)
  if (!result.ok) {
    return { ok: false, message: result.error }
  }

  const resolvedByKey = new Map(result.rows.map((row) => [row.key, row]))
  const rows: PreparedSplit[] = prepared.map((row) => {
    const resolved = resolvedByKey.get(row.key)!
    return {
      debtorUserId: row.debtorUserId,
      debtorExternalId: row.debtorExternalId,
      newExternalName: row.newExternalName,
      splitInputType,
      splitRatio: resolved.ratio,
      amountDue: resolved.amountDue,
    }
  })
  return { ok: true, rows }
}

export const expensesRoute = new Hono<AppEnv>()

expensesRoute.use('*', requireAuth)

expensesRoute.get('/', async (c) => {
  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const categoryId = parseOptionalIntQueryParam(c.req.query('categoryId'))
  if (categoryId === null) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const conditions = [eq(expenses.householdId, householdId), eq(expenses.payerUserId, userId)]
  if (categoryId !== undefined) {
    conditions.push(eq(expenses.categoryId, categoryId))
  }

  const rows = await db
    .select()
    .from(expenses)
    .where(and(...conditions))
    .orderBy(desc(expenses.expenseDate), desc(expenses.id))
    .all()

  return c.json(rows.map(toResponse))
})

expensesRoute.post('/', async (c) => {
  const parsed = createExpenseSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { expenseDate, amount, purpose, categoryId, memo, includeInHouseholdTotal, accountId, cardId, eventId, splitInputType, splits } =
    parsed.data

  if (accountId != null && cardId != null) {
    return c.json(errorResponse('VALIDATION_ERROR', ACCOUNT_AND_CARD_BOTH_SPECIFIED_MESSAGE), 400)
  }

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const category = await db
    .select()
    .from(kakeiboCategories)
    .where(and(eq(kakeiboCategories.id, categoryId), eq(kakeiboCategories.householdId, householdId)))
    .get()
  if (!category) {
    return c.json(errorResponse('VALIDATION_ERROR', CATEGORY_NOT_FOUND_MESSAGE), 400)
  }

  if (eventId != null) {
    // 個人公開イベント(owner_user_id設定済み)は本人のみ閲覧可能(F06ドキュメント7-2章
    // 「本人のみ閲覧・編集可能で、他の世帯メンバーのカレンダー・一覧・集計には表示されない」)。
    // 紐付け対象も同じ可視性で絞り込み、他人の個人イベントIDを推測しても紐付けられないようにする
    // (events.tsのGET一覧と同じ可視性条件)。
    const event = await db
      .select()
      .from(events)
      .where(
        and(
          eq(events.id, eventId),
          eq(events.householdId, householdId),
          or(isNull(events.ownerUserId), eq(events.ownerUserId, userId)),
        ),
      )
      .get()
    if (!event) {
      return c.json(errorResponse('VALIDATION_ERROR', INVALID_EVENT_MESSAGE), 400)
    }
  }

  // 割り勘内訳(F-04)。指定があれば検証・計算し、支出INSERT後にまとめてINSERTする。
  const preparedSplits = await prepareSplits(db, householdId, userId, amount, splitInputType ?? 'ratio', splits ?? [])
  if (!preparedSplits.ok) {
    return c.json(errorResponse('VALIDATION_ERROR', preparedSplits.message), 400)
  }

  // 実際に支出行へ設定するaccount_id/card_id。creditカードが指定された場合は
  // (カード自体は残高を持たないため)親口座のIDをaccount_idに設定し、card_idはNULLのままにする
  // (既存Java実装のinsertExpenseForCardと同じ挙動)。
  let resolvedAccountId: number | null = null
  let resolvedCardId: number | null = null
  let balanceUpdateStatement: { table: 'accounts' | 'cards'; id: number } | null = null

  if (cardId != null) {
    const card = await db.select().from(cards).where(eq(cards.id, cardId)).get()
    if (!card) {
      return c.json(errorResponse('VALIDATION_ERROR', INVALID_CARD_MESSAGE), 400)
    }
    const account = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, card.accountId), eq(accounts.householdId, householdId), eq(accounts.ownerUserId, userId)))
      .get()
    if (!account) {
      return c.json(errorResponse('VALIDATION_ERROR', INVALID_CARD_MESSAGE), 400)
    }
    if (card.cardType === 'charge') {
      resolvedCardId = cardId
      balanceUpdateStatement = { table: 'cards', id: cardId }
    } else {
      resolvedAccountId = card.accountId
      balanceUpdateStatement = { table: 'accounts', id: card.accountId }
    }
  } else if (accountId != null) {
    const account = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId), eq(accounts.ownerUserId, userId)))
      .get()
    if (!account) {
      return c.json(errorResponse('VALIDATION_ERROR', INVALID_ACCOUNT_MESSAGE), 400)
    }
    resolvedAccountId = accountId
    balanceUpdateStatement = { table: 'accounts', id: accountId }
  }

  // 新規の世帯外の相手を先に作成しIDへ解決する。ここで失敗しても残るのは名前マスタの行のみで
  // 参照整合性・残高・支出には一切影響しないため、支出本体のバッチとは分けてよい(P1対応)。
  const externalIdByName = new Map<string, number>()
  const newExternalNames = [...new Set(preparedSplits.rows.map((row) => row.newExternalName).filter((n): n is string => !!n))]
  if (newExternalNames.length > 0) {
    const created = await c.env.DB.batch(
      newExternalNames.map((name) =>
        c.env.DB.prepare('INSERT INTO external_persons (household_id, name) VALUES (?, ?) RETURNING id').bind(householdId, name),
      ),
    )
    created.forEach((result, index) => {
      const inserted = result.results[0] as { id: number }
      externalIdByName.set(newExternalNames[index], inserted.id)
    })
  }

  const resolvedSplitRows = preparedSplits.rows.map((row) => ({
    ...row,
    debtorExternalId: row.newExternalName ? externalIdByName.get(row.newExternalName)! : row.debtorExternalId,
  }))

  // 「支出INSERT」+「割り勘内訳INSERT」+「(口座/カード指定時)残高の相対減算UPDATE」を1つのD1バッチ
  // (トランザクション)にまとめて原子的に確定する。バッチは順次実行され後続文は先行文の書き込みを
  // 見られるため、内訳INSERTの expense_id は同一トランザクション内の (SELECT MAX(id) FROM expenses) で解決する
  // (バッチはSQLiteトランザクションで隔離されるため、途中で他の支出INSERTが割り込むことはない)。
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO expenses
         (household_id, payer_user_id, category_id, account_id, card_id, event_id, amount, purpose, memo, expense_date, include_in_household_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    ).bind(
      householdId,
      userId,
      categoryId,
      resolvedAccountId,
      resolvedCardId,
      eventId ?? null,
      amount,
      purpose?.trim() ? purpose.trim() : '',
      memo ?? null,
      expenseDate,
      includeInHouseholdTotal ? 1 : 0,
    ),
  ]
  for (const row of resolvedSplitRows) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO expense_splits
           (expense_id, debtor_user_id, debtor_external_id, split_input_type, split_ratio, amount_due, status)
         VALUES ((SELECT MAX(id) FROM expenses), ?, ?, ?, ?, ?, 'unpaid')`,
      ).bind(row.debtorUserId, row.debtorExternalId, row.splitInputType, row.splitRatio, row.amountDue),
    )
  }
  if (balanceUpdateStatement) {
    statements.push(
      c.env.DB
        .prepare(`UPDATE ${balanceUpdateStatement.table} SET balance = balance - ? WHERE id = ?`)
        .bind(amount, balanceUpdateStatement.id),
    )
  }

  const results = await c.env.DB.batch(statements)
  const insertedRow = results[0].results[0] as {
    id: number
    expense_date: string
    amount: number
    purpose: string
    category_id: number
    memo: string | null
    include_in_household_total: number
    account_id: number | null
    card_id: number | null
    event_id: number | null
  }

  const insertedSplits = resolvedSplitRows.map((row) => ({
    debtorUserId: row.debtorUserId,
    debtorExternalId: row.debtorExternalId,
    splitInputType: row.splitInputType,
    splitRatio: row.splitRatio,
    amountDue: row.amountDue,
    status: 'unpaid' as const,
  }))

  return c.json(
    {
      id: insertedRow.id,
      expenseDate: insertedRow.expense_date,
      amount: insertedRow.amount,
      purpose: insertedRow.purpose,
      categoryId: insertedRow.category_id,
      memo: insertedRow.memo,
      includeInHouseholdTotal: Boolean(insertedRow.include_in_household_total),
      accountId: insertedRow.account_id,
      cardId: insertedRow.card_id,
      eventId: insertedRow.event_id,
      splits: insertedSplits,
    },
    201,
  )
})

import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { accounts, cards, fixedCostSplits, fixedCosts, householdMembers } from '../db/schema'
import { errorResponse } from '../lib/errors'
import { resolveHouseholdId } from '../lib/household-context'
import { resolveSplits, type SplitInputRow } from '../lib/split-calc'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const NOT_FOUND_MESSAGE = '固定費が見つかりません'
const ACCOUNT_AND_CARD_BOTH_SPECIFIED_MESSAGE = '口座とカードは同時に指定できません'
const INVALID_ACCOUNT_MESSAGE = '指定された口座が見つかりません'
const INVALID_CARD_MESSAGE = '指定されたカードが見つかりません'
const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'
const SPLIT_TARGET_NOT_MEMBER_MESSAGE = '割り勘の相手は世帯メンバーから選んでください'
const SPLIT_PAYER_AS_DEBTOR_MESSAGE = '自分を割り勘の相手に指定することはできません'
const SPLIT_DUPLICATE_MESSAGE = '同じ相手を複数回指定することはできません'

const AMOUNT_MAX = 9_999_999_999

// 割り勘の相手(登録者以外の世帯メンバー)1人分。
const fixedCostSplitRowSchema = z.object({
  debtorUserId: z.number().int(),
  ratio: z.number().nonnegative().max(100).nullish(),
  amountDue: z.number().int().nonnegative().max(AMOUNT_MAX).nullish(),
})

const fixedCostSchema = z.object({
  name: z.string().max(50).refine((value) => value.trim().length > 0, { message: '固定費名を入力してください' }),
  amount: z.number().int().positive().max(AMOUNT_MAX),
  paymentDay: z.number().int().min(1).max(31),
  personal: z.boolean(),
  includeInHouseholdTotal: z.boolean().nullish(),
  accountId: z.number().int().nullish(),
  cardId: z.number().int().nullish(),
  splitInputType: z.enum(['ratio', 'amount']).nullish(),
  splits: z.array(fixedCostSplitRowSchema).max(20).nullish(),
})

async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

/**
 * 引き落とし元の口座/カード指定を検証する。登録者(created_by_user_id)本人が所有するものに限る
 * (既存Java実装のvalidateAndResolveAccountOrCardと同じ)。
 */
async function validateAccountOrCard(
  db: ReturnType<typeof drizzle>,
  userId: number,
  householdId: number,
  accountId: number | null | undefined,
  cardId: number | null | undefined,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (accountId != null && cardId != null) {
    return { ok: false, message: ACCOUNT_AND_CARD_BOTH_SPECIFIED_MESSAGE }
  }
  if (cardId != null) {
    const card = await db.select().from(cards).where(eq(cards.id, cardId)).get()
    if (!card) {
      return { ok: false, message: INVALID_CARD_MESSAGE }
    }
    const account = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, card.accountId), eq(accounts.householdId, householdId), eq(accounts.ownerUserId, userId)))
      .get()
    if (!account) {
      return { ok: false, message: INVALID_CARD_MESSAGE }
    }
  } else if (accountId != null) {
    const account = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId), eq(accounts.ownerUserId, userId)))
      .get()
    if (!account) {
      return { ok: false, message: INVALID_ACCOUNT_MESSAGE }
    }
  }
  return { ok: true }
}

interface PreparedSplit {
  debtorUserId: number
  splitInputType: 'ratio' | 'amount'
  splitRatio: number
  amountDue: number
}

type FixedCostSplitInput = z.infer<typeof fixedCostSplitRowSchema>

/**
 * 固定費の割り勘設定を検証し、保存する行を確定する。負担者(登録者以外の世帯メンバー)のみを行にし、
 * 登録者本人の負担分は「固定費金額 - 相手の負担額合計」として暗黙に決まる(F-04 の支出割り勘と同じ考え方)。
 */
async function prepareFixedCostSplits(
  db: ReturnType<typeof drizzle>,
  householdId: number,
  payerUserId: number,
  amount: number,
  splitInputType: 'ratio' | 'amount',
  splits: FixedCostSplitInput[],
): Promise<{ ok: true; rows: PreparedSplit[] } | { ok: false; message: string }> {
  if (splits.length === 0) {
    return { ok: true, rows: [] }
  }

  const seen = new Set<number>()
  for (const row of splits) {
    if (row.debtorUserId === payerUserId) {
      return { ok: false, message: SPLIT_PAYER_AS_DEBTOR_MESSAGE }
    }
    if (seen.has(row.debtorUserId)) {
      return { ok: false, message: SPLIT_DUPLICATE_MESSAGE }
    }
    seen.add(row.debtorUserId)
  }

  const memberRows = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), inArray(householdMembers.userId, [...seen])))
    .all()
  if (memberRows.length !== seen.size) {
    return { ok: false, message: SPLIT_TARGET_NOT_MEMBER_MESSAGE }
  }

  const calcRows: SplitInputRow[] = splits.map((row) => ({
    key: `u:${row.debtorUserId}`,
    ratio: row.ratio,
    amountDue: row.amountDue,
  }))
  const result = resolveSplits(amount, splitInputType, calcRows)
  if (!result.ok) {
    return { ok: false, message: result.error }
  }
  const resolvedByKey = new Map(result.rows.map((row) => [row.key, row]))
  return {
    ok: true,
    rows: splits.map((row) => {
      const resolved = resolvedByKey.get(`u:${row.debtorUserId}`)!
      return { debtorUserId: row.debtorUserId, splitInputType, splitRatio: resolved.ratio, amountDue: resolved.amountDue }
    }),
  }
}

async function loadSplits(db: ReturnType<typeof drizzle>, fixedCostId: number) {
  return db
    .select({
      debtorUserId: fixedCostSplits.debtorUserId,
      splitInputType: fixedCostSplits.splitInputType,
      splitRatio: fixedCostSplits.splitRatio,
      amountDue: fixedCostSplits.amountDue,
    })
    .from(fixedCostSplits)
    .where(eq(fixedCostSplits.fixedCostId, fixedCostId))
    .orderBy(fixedCostSplits.id)
    .all()
}

function toResponse(
  fixedCost: typeof fixedCosts.$inferSelect,
  userId: number,
  splits: Awaited<ReturnType<typeof loadSplits>>,
) {
  const personal = fixedCost.ownerUserId !== null
  const editable = fixedCost.createdByUserId === userId
  return {
    id: fixedCost.id,
    name: fixedCost.name,
    amount: fixedCost.amount,
    paymentDay: fixedCost.paymentDay,
    personal,
    includeInHouseholdTotal: fixedCost.includeInHouseholdTotal,
    editable,
    accountId: editable ? fixedCost.accountId : null,
    cardId: editable ? fixedCost.cardId : null,
    // 割り勘設定は登録者本人にのみ返す(他人の負担額を露出させない)。
    splitInputType: editable ? (splits[0]?.splitInputType ?? null) : null,
    splits: editable ? splits.map((s) => ({ debtorUserId: s.debtorUserId, splitRatio: s.splitRatio, amountDue: s.amountDue })) : [],
  }
}

export const fixedCostsRoute = new Hono<AppEnv>()

fixedCostsRoute.use('*', requireAuth)

fixedCostsRoute.get('/', async (c) => {
  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  // 世帯共有(owner_user_id IS NULL)または自分が所有する固定費のみを表示する
  // (既存Java実装のfindVisibleByHouseholdIdAndUserIdと同じ)。
  const rows = await db
    .select()
    .from(fixedCosts)
    .where(and(eq(fixedCosts.householdId, householdId), or(isNull(fixedCosts.ownerUserId), eq(fixedCosts.ownerUserId, userId))))
    .orderBy(fixedCosts.id)
    .all()

  // 自分が登録した固定費の割り勘設定だけをまとめて取得する。
  const ownIds = rows.filter((row) => row.createdByUserId === userId).map((row) => row.id)
  const allSplits =
    ownIds.length === 0
      ? []
      : await db
          .select({
            fixedCostId: fixedCostSplits.fixedCostId,
            debtorUserId: fixedCostSplits.debtorUserId,
            splitInputType: fixedCostSplits.splitInputType,
            splitRatio: fixedCostSplits.splitRatio,
            amountDue: fixedCostSplits.amountDue,
          })
          .from(fixedCostSplits)
          .where(inArray(fixedCostSplits.fixedCostId, ownIds))
          .orderBy(fixedCostSplits.id)
          .all()
  const splitsByFixedCost = new Map<number, typeof allSplits>()
  for (const s of allSplits) {
    const list = splitsByFixedCost.get(s.fixedCostId) ?? []
    list.push(s)
    splitsByFixedCost.set(s.fixedCostId, list)
  }

  return c.json(rows.map((row) => toResponse(row, userId, splitsByFixedCost.get(row.id) ?? [])))
})

fixedCostsRoute.post('/', async (c) => {
  const parsed = fixedCostSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const { name, amount, paymentDay, personal, includeInHouseholdTotal, accountId, cardId, splitInputType, splits } = parsed.data
  const validation = await validateAccountOrCard(db, userId, householdId, accountId, cardId)
  if (!validation.ok) {
    return c.json(errorResponse('VALIDATION_ERROR', validation.message), 400)
  }
  const preparedSplits = await prepareFixedCostSplits(db, householdId, userId, amount, splitInputType ?? 'ratio', splits ?? [])
  if (!preparedSplits.ok) {
    return c.json(errorResponse('VALIDATION_ERROR', preparedSplits.message), 400)
  }

  // 固定費本体と割り勘設定を1つのD1バッチ(トランザクション)で確定する。割り勘INSERTの fixed_cost_id は
  // 同一トランザクション内の (SELECT MAX(id) FROM fixed_costs) で解決する。
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO fixed_costs
         (household_id, owner_user_id, created_by_user_id, account_id, card_id, name, amount, payment_day, include_in_household_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    ).bind(householdId, personal ? userId : null, userId, accountId ?? null, cardId ?? null, name, amount, paymentDay, includeInHouseholdTotal ? 1 : 0),
    ...preparedSplits.rows.map((row) =>
      c.env.DB
        .prepare(
          `INSERT INTO fixed_cost_splits (fixed_cost_id, debtor_user_id, split_input_type, split_ratio, amount_due)
           VALUES ((SELECT MAX(id) FROM fixed_costs), ?, ?, ?, ?)`,
        )
        .bind(row.debtorUserId, row.splitInputType, row.splitRatio, row.amountDue),
    ),
  ])
  const newId = (results[0].results[0] as { id: number }).id
  const created = await db.select().from(fixedCosts).where(eq(fixedCosts.id, newId)).get()

  return c.json(toResponse(created!, userId, await loadSplits(db, newId)), 201)
})

fixedCostsRoute.patch('/:id', async (c) => {
  const parsed = fixedCostSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const fixedCostId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  // 世帯共有の固定費であっても、編集・削除できるのは登録者(created_by_user_id)本人のみ
  // (既存Java実装のfindEditableと同じ。誤って他人の家賃を削除・変更する事故を防ぐため)。
  const fixedCost = await db
    .select()
    .from(fixedCosts)
    .where(and(eq(fixedCosts.id, fixedCostId), eq(fixedCosts.householdId, householdId), eq(fixedCosts.createdByUserId, userId)))
    .get()
  if (!fixedCost) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  const { name, amount, paymentDay, personal, includeInHouseholdTotal, accountId, cardId, splitInputType, splits } = parsed.data
  const validation = await validateAccountOrCard(db, userId, householdId, accountId, cardId)
  if (!validation.ok) {
    return c.json(errorResponse('VALIDATION_ERROR', validation.message), 400)
  }
  const preparedSplits = await prepareFixedCostSplits(db, householdId, userId, amount, splitInputType ?? 'ratio', splits ?? [])
  if (!preparedSplits.ok) {
    return c.json(errorResponse('VALIDATION_ERROR', preparedSplits.message), 400)
  }

  const ownerUserId = personal ? userId : null
  // 固定費の更新・既存割り勘設定の削除・新しい割り勘設定の追加を1つのD1バッチで確定する
  // (途中失敗で「金額だけ更新／割り勘設定だけ消える」状態を作らない)。
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `UPDATE fixed_costs SET name = ?, amount = ?, payment_day = ?, owner_user_id = ?,
           include_in_household_total = ?, account_id = ?, card_id = ? WHERE id = ?`,
      )
      .bind(name, amount, paymentDay, ownerUserId, includeInHouseholdTotal ? 1 : 0, accountId ?? null, cardId ?? null, fixedCostId),
    c.env.DB.prepare('DELETE FROM fixed_cost_splits WHERE fixed_cost_id = ?').bind(fixedCostId),
    ...preparedSplits.rows.map((row) =>
      c.env.DB
        .prepare(
          `INSERT INTO fixed_cost_splits (fixed_cost_id, debtor_user_id, split_input_type, split_ratio, amount_due)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(fixedCostId, row.debtorUserId, row.splitInputType, row.splitRatio, row.amountDue),
    ),
  ])

  return c.json(
    toResponse(
      {
        ...fixedCost,
        name,
        amount,
        paymentDay,
        ownerUserId,
        includeInHouseholdTotal: includeInHouseholdTotal ?? false,
        accountId: accountId ?? null,
        cardId: cardId ?? null,
      },
      userId,
      await loadSplits(db, fixedCostId),
    ),
  )
})

fixedCostsRoute.delete('/:id', async (c) => {
  const fixedCostId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const fixedCost = await db
    .select()
    .from(fixedCosts)
    .where(and(eq(fixedCosts.id, fixedCostId), eq(fixedCosts.householdId, householdId), eq(fixedCosts.createdByUserId, userId)))
    .get()
  if (!fixedCost) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  await db.delete(fixedCosts).where(eq(fixedCosts.id, fixedCostId))

  return c.body(null, 204)
})

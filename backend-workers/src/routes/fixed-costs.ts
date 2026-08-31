import { and, eq, isNull, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { accounts, cards, fixedCosts } from '../db/schema'
import { errorResponse } from '../lib/errors'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const NOT_FOUND_MESSAGE = '固定費が見つかりません'
const ACCOUNT_AND_CARD_BOTH_SPECIFIED_MESSAGE = '口座とカードは同時に指定できません'
const INVALID_ACCOUNT_MESSAGE = '指定された口座が見つかりません'
const INVALID_CARD_MESSAGE = '指定されたカードが見つかりません'
const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'

const AMOUNT_MAX = 9_999_999_999

const fixedCostSchema = z.object({
  name: z.string().max(50).refine((value) => value.trim().length > 0, { message: '固定費名を入力してください' }),
  amount: z.number().int().positive().max(AMOUNT_MAX),
  paymentDay: z.number().int().min(1).max(31),
  personal: z.boolean(),
  includeInHouseholdTotal: z.boolean().nullish(),
  accountId: z.number().int().nullish(),
  cardId: z.number().int().nullish(),
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

function toResponse(fixedCost: typeof fixedCosts.$inferSelect, userId: number) {
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

  return c.json(rows.map((row) => toResponse(row, userId)))
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

  const { name, amount, paymentDay, personal, includeInHouseholdTotal, accountId, cardId } = parsed.data
  const validation = await validateAccountOrCard(db, userId, householdId, accountId, cardId)
  if (!validation.ok) {
    return c.json(errorResponse('VALIDATION_ERROR', validation.message), 400)
  }

  const inserted = await db
    .insert(fixedCosts)
    .values({
      householdId,
      ownerUserId: personal ? userId : null,
      createdByUserId: userId,
      accountId: accountId ?? null,
      cardId: cardId ?? null,
      name,
      amount,
      paymentDay,
      includeInHouseholdTotal: includeInHouseholdTotal ?? false,
    })
    .returning()
    .get()

  return c.json(toResponse(inserted, userId), 201)
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

  const { name, amount, paymentDay, personal, includeInHouseholdTotal, accountId, cardId } = parsed.data
  const validation = await validateAccountOrCard(db, userId, householdId, accountId, cardId)
  if (!validation.ok) {
    return c.json(errorResponse('VALIDATION_ERROR', validation.message), 400)
  }

  const ownerUserId = personal ? userId : null
  await db
    .update(fixedCosts)
    .set({
      name,
      amount,
      paymentDay,
      ownerUserId,
      includeInHouseholdTotal: includeInHouseholdTotal ?? false,
      accountId: accountId ?? null,
      cardId: cardId ?? null,
    })
    .where(eq(fixedCosts.id, fixedCostId))

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

import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { accounts, cardCharges, cards, expenses } from '../db/schema'
import { errorResponse } from '../lib/errors'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const NOT_FOUND_MESSAGE = '口座が見つかりません'
const IN_USE_MESSAGE = '使用中の口座は削除できません'
const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'

const BALANCE_MIN = -9_999_999_999
const BALANCE_MAX = 9_999_999_999

const createAccountSchema = z.object({
  name: z.string().max(50).refine((value) => value.trim().length > 0, { message: '口座名を入力してください' }),
  type: z.string().max(20).refine((value) => value.trim().length > 0, { message: '種別を入力してください' }),
  balance: z.number().int().min(BALANCE_MIN).max(BALANCE_MAX),
})

const updateAccountSchema = z.object({
  name: z.string().max(50).refine((value) => value.trim().length > 0, { message: '口座名を入力してください' }),
  type: z.string().max(20).refine((value) => value.trim().length > 0, { message: '種別を入力してください' }),
})

async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

export const accountsRoute = new Hono<AppEnv>()

accountsRoute.use('*', requireAuth)

accountsRoute.get('/', async (c) => {
  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const ownedAccounts = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), eq(accounts.ownerUserId, userId)))
    .orderBy(accounts.id)
    .all()

  const result = []
  for (const account of ownedAccounts) {
    const accountCards = await db.select().from(cards).where(eq(cards.accountId, account.id)).orderBy(cards.id).all()
    result.push({
      id: account.id,
      name: account.name,
      type: account.type,
      balance: account.balance,
      cards: accountCards.map((card) => ({
        id: card.id,
        name: card.name,
        accountId: card.accountId,
        cardType: card.cardType,
        balance: card.balance,
      })),
    })
  }

  return c.json(result)
})

accountsRoute.post('/', async (c) => {
  const parsed = createAccountSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const { name, type, balance } = parsed.data
  const inserted = await db.insert(accounts).values({ householdId, ownerUserId: userId, name, type, balance }).returning().get()

  return c.json({ id: inserted.id, name: inserted.name, type: inserted.type, balance: inserted.balance, cards: [] }, 201)
})

accountsRoute.patch('/:id', async (c) => {
  const parsed = updateAccountSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const accountId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const account = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId), eq(accounts.ownerUserId, userId)))
    .get()
  if (!account) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  const { name, type } = parsed.data
  await db.update(accounts).set({ name, type }).where(eq(accounts.id, accountId))

  return c.json({ id: account.id, name, type, balance: account.balance })
})

accountsRoute.delete('/:id', async (c) => {
  const accountId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const account = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId), eq(accounts.ownerUserId, userId)))
    .get()
  if (!account) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  // fixed_costsに関する使用中チェックはPhase 5でfixed_costsテーブルを作成した後に追加する。
  const expenseUsage = await db.select().from(expenses).where(eq(expenses.accountId, accountId)).all()
  if (expenseUsage.length > 0) {
    return c.json(errorResponse('VALIDATION_ERROR', IN_USE_MESSAGE), 400)
  }
  const chargeUsage = await db.select().from(cardCharges).where(eq(cardCharges.fromAccountId, accountId)).all()
  if (chargeUsage.length > 0) {
    return c.json(errorResponse('VALIDATION_ERROR', IN_USE_MESSAGE), 400)
  }
  const undeletableCards = await db
    .select()
    .from(cards)
    .where(eq(cards.accountId, accountId))
    .all()
  for (const card of undeletableCards) {
    if (card.balance !== 0) {
      return c.json(errorResponse('VALIDATION_ERROR', IN_USE_MESSAGE), 400)
    }
    const cardExpenseUsage = await db.select().from(expenses).where(eq(expenses.cardId, card.id)).all()
    if (cardExpenseUsage.length > 0) {
      return c.json(errorResponse('VALIDATION_ERROR', IN_USE_MESSAGE), 400)
    }
    const cardChargeUsage = await db.select().from(cardCharges).where(eq(cardCharges.cardId, card.id)).all()
    if (cardChargeUsage.length > 0) {
      return c.json(errorResponse('VALIDATION_ERROR', IN_USE_MESSAGE), 400)
    }
  }

  await db.delete(accounts).where(eq(accounts.id, accountId))

  return c.body(null, 204)
})

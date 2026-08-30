import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { accounts, cardCharges, cards, expenses } from '../db/schema'
import { errorResponse } from '../lib/errors'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const NOT_FOUND_MESSAGE = 'カードが見つかりません'
const INVALID_ACCOUNT_MESSAGE = '指定された口座が見つかりません'
const IN_USE_MESSAGE = '使用中のカードは削除できません'
const NOT_CHARGE_CARD_MESSAGE = 'チャージ型カードではありません'
const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'

const AMOUNT_MAX = 9_999_999_999

const createCardSchema = z.object({
  accountId: z.number().int(),
  name: z.string().max(50).refine((value) => value.trim().length > 0, { message: 'カード名を入力してください' }),
  cardType: z.enum(['credit', 'charge']).nullish(),
})

const updateCardSchema = z.object({
  name: z.string().max(50).refine((value) => value.trim().length > 0, { message: 'カード名を入力してください' }),
})

const chargeCardSchema = z.object({
  fromAccountId: z.number().int(),
  amount: z.number().int().positive().max(AMOUNT_MAX),
})

async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

/** 口座がその世帯・本人所有かを検証する(見つからなければnullを返す)。 */
async function findOwnedAccount(db: ReturnType<typeof drizzle>, userId: number, householdId: number, accountId: number) {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId), eq(accounts.ownerUserId, userId)))
    .get()
}

/** カードが(親口座経由で)本人所有かを検証する。 */
async function findOwnedCard(db: ReturnType<typeof drizzle>, userId: number, householdId: number, cardId: number) {
  const card = await db.select().from(cards).where(eq(cards.id, cardId)).get()
  if (!card) {
    return null
  }
  const account = await findOwnedAccount(db, userId, householdId, card.accountId)
  if (!account) {
    return null
  }
  return card
}

export const cardsRoute = new Hono<AppEnv>()

cardsRoute.use('*', requireAuth)

cardsRoute.post('/', async (c) => {
  const parsed = createCardSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const account = await findOwnedAccount(db, userId, householdId, parsed.data.accountId)
  if (!account) {
    return c.json(errorResponse('VALIDATION_ERROR', INVALID_ACCOUNT_MESSAGE), 400)
  }

  const cardType = parsed.data.cardType ?? 'credit'
  const inserted = await db
    .insert(cards)
    .values({ accountId: parsed.data.accountId, name: parsed.data.name, cardType, balance: 0 })
    .returning()
    .get()

  return c.json(
    { id: inserted.id, name: inserted.name, accountId: inserted.accountId, cardType: inserted.cardType, balance: inserted.balance },
    201,
  )
})

cardsRoute.patch('/:id', async (c) => {
  const parsed = updateCardSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const cardId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const card = await findOwnedCard(db, userId, householdId, cardId)
  if (!card) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  await db.update(cards).set({ name: parsed.data.name }).where(eq(cards.id, cardId))

  return c.json({ id: card.id, name: parsed.data.name, accountId: card.accountId, cardType: card.cardType, balance: card.balance })
})

cardsRoute.delete('/:id', async (c) => {
  const cardId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const card = await findOwnedCard(db, userId, householdId, cardId)
  if (!card) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  // fixed_costsに関する使用中チェックはPhase 5でfixed_costsテーブルを作成した後に追加する。
  const expenseUsage = await db.select().from(expenses).where(eq(expenses.cardId, cardId)).all()
  const chargeUsage = await db.select().from(cardCharges).where(eq(cardCharges.cardId, cardId)).all()
  if (expenseUsage.length > 0 || chargeUsage.length > 0) {
    return c.json(errorResponse('VALIDATION_ERROR', IN_USE_MESSAGE), 400)
  }

  await db.delete(cards).where(eq(cards.id, cardId))

  return c.body(null, 204)
})

cardsRoute.post('/:id/charges', async (c) => {
  const parsed = chargeCardSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const cardId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const card = await findOwnedCard(db, userId, householdId, cardId)
  if (!card) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }
  if (card.cardType !== 'charge') {
    return c.json(errorResponse('VALIDATION_ERROR', NOT_CHARGE_CARD_MESSAGE), 400)
  }
  const fromAccount = await findOwnedAccount(db, userId, householdId, parsed.data.fromAccountId)
  if (!fromAccount) {
    return c.json(errorResponse('VALIDATION_ERROR', INVALID_ACCOUNT_MESSAGE), 400)
  }

  const { amount } = parsed.data
  // 「チャージ履歴INSERT」+「口座残高の相対減算」+「カード残高の相対加算」を1つのD1バッチ
  // (トランザクション)にまとめる(既存Javaの口座→カードの順でのFOR UPDATEロックに代わる方式)。
  // 残高不足時の制御は設けない(F11_kakeibo_account.md参照、既存Java実装と同じ方針)。
  await c.env.DB.batch([
    c.env.DB
      .prepare('INSERT INTO card_charges (card_id, from_account_id, amount) VALUES (?, ?, ?)')
      .bind(cardId, parsed.data.fromAccountId, amount),
    c.env.DB.prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?').bind(amount, parsed.data.fromAccountId),
    c.env.DB.prepare('UPDATE cards SET balance = balance + ? WHERE id = ?').bind(amount, cardId),
  ])

  const [updatedAccount, updatedCard, insertedCharge] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.id, parsed.data.fromAccountId)).get(),
    db.select().from(cards).where(eq(cards.id, cardId)).get(),
    db.select().from(cardCharges).where(eq(cardCharges.cardId, cardId)).orderBy(cardCharges.id).all(),
  ])
  const latestCharge = insertedCharge.at(-1)

  return c.json({
    id: latestCharge?.id,
    cardId,
    fromAccountId: parsed.data.fromAccountId,
    amount,
    cardBalanceAfter: updatedCard?.balance,
    accountBalanceAfter: updatedAccount?.balance,
    createdAt: latestCharge?.createdAt,
  })
})

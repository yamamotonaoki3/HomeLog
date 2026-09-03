import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { accounts, cardCharges, cards, expenses, fixedCosts } from '../db/schema'
import { utcTimestampToJstDate } from '../lib/date'
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

// 口座の取引履歴(S-15、F11_kakeibo_account.md §4)。
// accounts.balance を増減させるのは「支出(expenses.account_id)」「収入(incomes.account_id)」
// 「チャージ元(card_charges.from_account_id)」の3種のみ。いずれも削除エンドポイントが無く、
// PATCH /accounts/:id も残高を触らないため、現在残高から符号付き差分を遡って各行の取引後残高を
// 正確に再構成できる。
interface TransactionRow {
  id: number
  type: 'expense' | 'income' | 'charge'
  date: string
  description: string
  category: string | null
  memo: string | null
  direction: 'in' | 'out'
  amount: number
  balanceAfter: number
}

accountsRoute.get('/:id/transactions', async (c) => {
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

  const [expenseRows, incomeRows, chargeRows] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT e.id, e.expense_date AS date, e.amount, e.purpose, e.memo, e.created_at, k.name AS category
         FROM expenses e JOIN kakeibo_categories k ON k.id = e.category_id
        WHERE e.account_id = ?`,
    ).bind(accountId),
    c.env.DB.prepare(
      `SELECT i.id, i.income_date AS date, i.amount, i.content, i.memo, i.created_at, ic.name AS category
         FROM incomes i JOIN income_categories ic ON ic.id = i.category_id
        WHERE i.account_id = ?`,
    ).bind(accountId),
    c.env.DB.prepare(
      `SELECT ch.id, ch.amount, ch.created_at, cd.name AS card_name
         FROM card_charges ch JOIN cards cd ON cd.id = ch.card_id
        WHERE ch.from_account_id = ?`,
    ).bind(accountId),
  ])

  type Raw = { row: Omit<TransactionRow, 'balanceAfter'>; sortKey: string }
  const merged: Raw[] = []
  for (const r of expenseRows.results as { id: number; date: string; amount: number; purpose: string; memo: string | null; created_at: string; category: string }[]) {
    merged.push({
      row: {
        id: r.id,
        type: 'expense',
        date: r.date,
        description: r.purpose.trim() !== '' ? r.purpose : r.category,
        category: r.category,
        memo: r.memo,
        direction: 'out',
        amount: r.amount,
      },
      sortKey: r.created_at ?? r.date,
    })
  }
  for (const r of incomeRows.results as { id: number; date: string; amount: number; content: string; memo: string | null; created_at: string; category: string }[]) {
    merged.push({
      row: {
        id: r.id,
        type: 'income',
        date: r.date,
        description: r.content,
        category: r.category,
        memo: r.memo,
        direction: 'in',
        amount: r.amount,
      },
      sortKey: r.created_at ?? r.date,
    })
  }
  for (const r of chargeRows.results as { id: number; amount: number; created_at: string; card_name: string }[]) {
    merged.push({
      row: {
        id: r.id,
        type: 'charge',
        // card_charges は明示的な日付列を持たない。created_at(UTC)をJST日付へ変換して「取引日」とする。
        date: r.created_at ? utcTimestampToJstDate(r.created_at) : '',
        description: `「${r.card_name}」へチャージ`,
        category: null,
        memo: null,
        direction: 'out',
        amount: r.amount,
      },
      sortKey: r.created_at ?? '',
    })
  }

  // 同一秒・異ソースの取引(例: 固定費の一括計上)は created_at だけでは順序が決まらないため、
  // 種別・id で決定的に補完する(同一ソース内の id は登録順そのもの)。
  const typeOrder: Record<TransactionRow['type'], number> = { charge: 0, expense: 1, income: 2 }
  const compareMutationDesc = (a: Raw, b: Raw): number => {
    if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? 1 : -1
    if (a.row.type !== b.row.type) return typeOrder[a.row.type] - typeOrder[b.row.type]
    return b.row.id - a.row.id
  }

  // (1) 取引後残高は「口座残高が実際に変動した順(= created_at 順)」で再構成する。
  // 業務日付(expense_date 等)は遡って登録できるため、表示順とは別に計算する必要がある。
  let running = account.balance
  const balanceByKey = new Map<string, number>()
  for (const item of [...merged].sort(compareMutationDesc)) {
    balanceByKey.set(`${item.row.type}:${item.row.id}`, running)
    running -= item.row.direction === 'in' ? item.row.amount : -item.row.amount
  }

  // (2) 表示は業務日付の降順(同日は created_at 降順 → 種別 → id)。各行の残高は (1) で確定済みのものを使う。
  merged.sort((a, b) => {
    if (a.row.date !== b.row.date) return a.row.date < b.row.date ? 1 : -1
    return compareMutationDesc(a, b)
  })
  const transactions: TransactionRow[] = merged.map(({ row }) => ({
    ...row,
    balanceAfter: balanceByKey.get(`${row.type}:${row.id}`) ?? account.balance,
  }))

  return c.json({ currentBalance: account.balance, transactions })
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

  const expenseUsage = await db.select().from(expenses).where(eq(expenses.accountId, accountId)).all()
  if (expenseUsage.length > 0) {
    return c.json(errorResponse('VALIDATION_ERROR', IN_USE_MESSAGE), 400)
  }
  const chargeUsage = await db.select().from(cardCharges).where(eq(cardCharges.fromAccountId, accountId)).all()
  if (chargeUsage.length > 0) {
    return c.json(errorResponse('VALIDATION_ERROR', IN_USE_MESSAGE), 400)
  }
  const fixedCostUsage = await db.select().from(fixedCosts).where(eq(fixedCosts.accountId, accountId)).all()
  if (fixedCostUsage.length > 0) {
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
    // カードを引き落とし元に指定する固定費が紐づいている場合も削除不可
    // (既存Java実装のfixedCostMapper.countByCardAccountIdと同じ)。
    const cardFixedCostUsage = await db.select().from(fixedCosts).where(eq(fixedCosts.cardId, card.id)).all()
    if (cardFixedCostUsage.length > 0) {
      return c.json(errorResponse('VALIDATION_ERROR', IN_USE_MESSAGE), 400)
    }
  }

  await db.delete(accounts).where(eq(accounts.id, accountId))

  return c.body(null, 204)
})

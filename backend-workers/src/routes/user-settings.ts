import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'
import { errorResponse } from '../lib/errors'

const ORDERABLE_CARDS = ['today', 'stock', 'finance', 'money', 'eventExpenses'] as const
type OrderableCard = (typeof ORDERABLE_CARDS)[number]

const cardOrderSchema = z
  .array(z.enum(ORDERABLE_CARDS))
  .refine((order) => new Set(order).size === order.length, { message: 'カード順が重複しています' })

const settingsSchema = z.object({
  cards: z.object({
    today: z.boolean(),
    stock: z.boolean(),
    finance: z.boolean(),
    money: z.boolean(),
    eventExpenses: z.boolean(),
    calendar: z.boolean(),
  }),
  cardOrder: cardOrderSchema.optional(),
  items: z.object({
    today: z.object({ balance: z.boolean(), menu: z.boolean(), events: z.boolean() }),
    stock: z.object({ shoppingList: z.boolean(), inventoryList: z.boolean() }),
    money: z.object({ personal: z.boolean(), householdTotal: z.boolean(), unsettled: z.boolean() }),
    calendar: z.object({ income: z.boolean(), expense: z.boolean(), events: z.boolean() }),
  }),
})

const settingsWithAliasesSchema = settingsSchema.extend({
  items: settingsSchema.shape.items.extend({
    stock: settingsSchema.shape.items.shape.stock.extend({ shoppingCount: z.boolean().optional(), lowStock: z.boolean().optional() }),
    money: settingsSchema.shape.items.shape.money.extend({ eventSummary: z.boolean().optional() }),
    calendar: settingsSchema.shape.items.shape.calendar.extend({ balance: z.boolean().optional() }),
  }),
})

// #169 の再設計前の形式。保存済みの値と、再設計前のUIからの送信を受け付けるために残す。
const legacySettingsSchema = z.object({
  cards: z.object({ today: z.boolean(), money: z.boolean(), finance: z.boolean(), stock: z.boolean(), calendar: z.boolean() }),
  items: z.object({
    today: z.object({ balance: z.boolean(), menu: z.boolean(), events: z.boolean() }),
    money: z.object({ personal: z.boolean(), householdTotal: z.boolean(), unsettled: z.boolean(), eventSummary: z.boolean() }),
    stock: z.object({ shoppingCount: z.boolean(), lowStock: z.boolean(), commonItems: z.boolean().optional() }),
    calendar: z.object({ events: z.boolean(), balance: z.boolean() }),
  }),
})

type Settings = z.infer<typeof settingsSchema> & { cardOrder: OrderableCard[] }

const defaults: Settings = {
  cards: { today: true, stock: true, finance: true, money: true, eventExpenses: true, calendar: true },
  cardOrder: [...ORDERABLE_CARDS],
  items: {
    today: { balance: true, menu: true, events: true },
    stock: { shoppingList: true, inventoryList: true },
    money: { personal: true, householdTotal: true, unsettled: true },
    calendar: { income: true, expense: true, events: true },
  },
}

function completeOrder(order: OrderableCard[] | undefined): OrderableCard[] {
  const given = order ?? []
  return [...given, ...ORDERABLE_CARDS.filter((card) => !given.includes(card))]
}

function fromLegacy(legacy: z.infer<typeof legacySettingsSchema>): Settings {
  const { cards, items } = legacy
  return {
    cards: {
      today: cards.today,
      stock: cards.stock,
      finance: cards.finance,
      money: cards.money,
      eventExpenses: cards.money && items.money.eventSummary,
      calendar: cards.calendar,
    },
    cardOrder: [...ORDERABLE_CARDS],
    items: {
      today: items.today,
      stock: { shoppingList: items.stock.shoppingCount, inventoryList: items.stock.lowStock },
      money: { personal: items.money.personal, householdTotal: items.money.householdTotal, unsettled: items.money.unsettled },
      calendar: { income: items.calendar.balance, expense: items.calendar.balance, events: items.calendar.events },
    },
  }
}

function normalize(input: unknown): Settings | null {
  const current = settingsSchema.safeParse(input)
  if (current.success) {
    const aliases = settingsWithAliasesSchema.safeParse(input)
    if (!aliases.success) return null
    const { items } = aliases.data
    const settings = current.data
    const derived = withLegacyAliases({ ...settings, cardOrder: completeOrder(settings.cardOrder) }).items
    if (items.stock.shoppingCount !== undefined && items.stock.shoppingCount !== derived.stock.shoppingCount) {
      settings.items.stock.shoppingList = items.stock.shoppingCount
    }
    if (items.stock.lowStock !== undefined && items.stock.lowStock !== derived.stock.lowStock) {
      settings.items.stock.inventoryList = items.stock.lowStock
    }
    if (items.money.eventSummary !== undefined && items.money.eventSummary !== derived.money.eventSummary) {
      settings.cards.eventExpenses = items.money.eventSummary
    }
    if (items.calendar.balance !== undefined && items.calendar.balance !== derived.calendar.balance) {
      settings.items.calendar.income = items.calendar.balance
      settings.items.calendar.expense = items.calendar.balance
    }
    return { ...settings, cardOrder: completeOrder(settings.cardOrder) }
  }
  if (typeof input === 'object' && input !== null) {
    if ('cardOrder' in input) return null
    if ('cards' in input && typeof input.cards === 'object' && input.cards !== null && 'eventExpenses' in input.cards) return null
  }
  const legacy = legacySettingsSchema.safeParse(input)
  return legacy.success ? fromLegacy(legacy.data) : null
}

// #171/#174 のUI刷新後に廃止予定の互換エイリアス。
function withLegacyAliases(settings: Settings) {
  return {
    ...settings,
    items: {
      ...settings.items,
      stock: { ...settings.items.stock, shoppingCount: settings.items.stock.shoppingList, lowStock: settings.items.stock.inventoryList, commonItems: false },
      money: { ...settings.items.money, eventSummary: settings.cards.eventExpenses },
      calendar: { ...settings.items.calendar, balance: settings.items.calendar.income || settings.items.calendar.expense },
    },
  }
}

function parseStored(raw: string): Settings {
  try {
    return normalize(JSON.parse(raw)) ?? defaults
  } catch {
    return defaults
  }
}

export const userSettingsRoute = new Hono<AppEnv>()
userSettingsRoute.use('*', requireAuth)

userSettingsRoute.get('/', async (c) => {
  const row = await c.env.DB.prepare('SELECT dashboard_settings AS settings FROM user_settings WHERE user_id = ?')
    .bind(c.get('userId'))
    .first<{ settings: string }>()
  return c.json(withLegacyAliases(row ? parseStored(row.settings) : defaults))
})

userSettingsRoute.put('/', async (c) => {
  const settings = normalize(await c.req.json().catch(() => null))
  if (!settings) return c.json(errorResponse('VALIDATION_ERROR', '設定内容が不正です'), 400)
  await c.env.DB.prepare(
    'INSERT INTO user_settings (user_id, dashboard_settings) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET dashboard_settings = excluded.dashboard_settings, updated_at = current_timestamp',
  )
    .bind(c.get('userId'), JSON.stringify(settings))
    .run()
  return c.json(withLegacyAliases(settings))
})

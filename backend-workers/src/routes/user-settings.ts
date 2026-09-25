import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'
import { errorResponse } from '../lib/errors'

const settingsSchema = z.object({
  cards: z.object({ today: z.boolean(), money: z.boolean(), finance: z.boolean(), stock: z.boolean(), calendar: z.boolean() }),
  items: z.object({
    today: z.object({ balance: z.boolean(), menu: z.boolean(), events: z.boolean() }),
    money: z.object({ personal: z.boolean(), householdTotal: z.boolean(), unsettled: z.boolean(), eventSummary: z.boolean() }),
    stock: z.object({ shoppingCount: z.boolean(), lowStock: z.boolean(), commonItems: z.boolean() }),
    calendar: z.object({ events: z.boolean(), balance: z.boolean() }),
  }),
})
const defaults = settingsSchema.parse({ cards: { today: true, money: true, finance: true, stock: true, calendar: true }, items: { today: { balance: true, menu: true, events: true }, money: { personal: true, householdTotal: true, unsettled: true, eventSummary: true }, stock: { shoppingCount: true, lowStock: true, commonItems: true }, calendar: { events: true, balance: true } } })
export const userSettingsRoute = new Hono<AppEnv>()
userSettingsRoute.use('*', requireAuth)
userSettingsRoute.get('/', async (c) => {
  const row = await c.env.DB.prepare('SELECT dashboard_settings AS settings FROM user_settings WHERE user_id = ?').bind(c.get('userId')).first<{settings:string}>()
  if (!row) return c.json(defaults)
  const parsed = settingsSchema.safeParse(JSON.parse(row.settings))
  return c.json(parsed.success ? parsed.data : defaults)
})
userSettingsRoute.put('/', async (c) => {
  const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json(errorResponse('VALIDATION_ERROR', '設定内容が不正です'), 400)
  await c.env.DB.prepare('INSERT INTO user_settings (user_id, dashboard_settings) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET dashboard_settings = excluded.dashboard_settings, updated_at = current_timestamp').bind(c.get('userId'), JSON.stringify(parsed.data)).run()
  return c.json(parsed.data)
})

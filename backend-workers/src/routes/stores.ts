import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { inventoryItems, stores } from '../db/schema'
import { errorResponse } from '../lib/errors'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const NOT_FOUND_MESSAGE = '店舗が見つかりません'
const IN_USE_MESSAGE = '使用中の店舗は削除できません'
const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'

const storeNameSchema = z.object({
  name: z.string().max(50).refine((value) => value.trim().length > 0, { message: '店舗名を入力してください' }),
})

async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

export const storesRoute = new Hono<AppEnv>()

storesRoute.use('*', requireAuth)

storesRoute.get('/', async (c) => {
  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const rows = await db.select().from(stores).where(eq(stores.householdId, householdId)).all()
  return c.json(rows.map((store) => ({ id: store.id, name: store.name })))
})

storesRoute.post('/', async (c) => {
  const body = await parseJsonBody(c)
  const parsed = storeNameSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const inserted = await db.insert(stores).values({ householdId, name: parsed.data.name }).returning().get()

  return c.json({ id: inserted.id, name: inserted.name }, 201)
})

storesRoute.patch('/:id', async (c) => {
  const body = await parseJsonBody(c)
  const parsed = storeNameSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const storeId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const store = await db
    .select()
    .from(stores)
    .where(and(eq(stores.id, storeId), eq(stores.householdId, householdId)))
    .get()
  if (!store) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  await db.update(stores).set({ name: parsed.data.name }).where(eq(stores.id, storeId))

  return c.json({ id: store.id, name: parsed.data.name })
})

storesRoute.delete('/:id', async (c) => {
  const storeId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const householdId = await resolveHouseholdId(db, c.get('userId'))
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const store = await db
    .select()
    .from(stores)
    .where(and(eq(stores.id, storeId), eq(stores.householdId, householdId)))
    .get()
  if (!store) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  const usage = await db.select().from(inventoryItems).where(eq(inventoryItems.storeId, storeId)).all()
  if (usage.length > 0) {
    return c.json(errorResponse('VALIDATION_ERROR', IN_USE_MESSAGE), 400)
  }

  await db.delete(stores).where(eq(stores.id, storeId))

  return c.body(null, 204)
})

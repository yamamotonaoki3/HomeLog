import { and, eq, isNull, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { currentMonthRange, getJstToday, isValidCalendarDate } from '../lib/date'
import { errorResponse } from '../lib/errors'
import { events } from '../db/schema'
import { resolveHouseholdId } from '../lib/household-context'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const NOT_FOUND_MESSAGE = 'イベントが見つかりません'
const HOUSEHOLD_NOT_FOUND_MESSAGE = '世帯グループが見つかりません'
const INVALID_EVENT_DATE_MESSAGE = '日付の形式が不正です'
const START_TIME_REQUIRED_MESSAGE = '終日でない場合は開始時刻を入力してください'
const INVALID_TIME_FORMAT_MESSAGE = '時刻はHH:mm形式で入力してください'
const END_TIME_BEFORE_START_TIME_MESSAGE = '終了時刻は開始時刻より後にしてください'
const INVALID_PERIOD_MESSAGE = '対象期間はyearまたはmonthを指定してください'

const AMOUNT_MAX = 9_999_999_999

// "HH:mm"(0埋め2桁の時・分)のみを許可する。零埋めしない"9:00"のような入力や、
// 任意の文字列を弾く。零埋め済みの文字列同士であれば文字列比較がそのまま時刻の前後比較になる。
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const timeSchema = z.string().regex(TIME_PATTERN, { message: INVALID_TIME_FORMAT_MESSAGE })

const eventSchema = z
  .object({
    name: z.string().max(50).refine((value) => value.trim().length > 0, { message: 'イベント名を入力してください' }),
    eventDate: z.string().refine(isValidCalendarDate, { message: INVALID_EVENT_DATE_MESSAGE }),
    isAllDay: z.boolean().nullish(),
    startTime: timeSchema.nullish(),
    endTime: timeSchema.nullish(),
    recurrenceType: z.enum(['none', 'daily', 'weekly', 'monthly', 'yearly']).nullish(),
    notifyEnabled: z.boolean().nullish(),
    defaultAmount: z.number().int().positive().max(AMOUNT_MAX).nullish(),
    showOnDashboard: z.boolean().nullish(),
    personal: z.boolean(),
  })
  .refine((value) => value.isAllDay !== false || value.startTime != null, {
    message: START_TIME_REQUIRED_MESSAGE,
  })
  .refine(
    (value) => {
      if (value.isAllDay === false && value.startTime != null && value.endTime != null) {
        return value.endTime >= value.startTime
      }
      return true
    },
    { message: END_TIME_BEFORE_START_TIME_MESSAGE },
  )

async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

function toResponse(event: typeof events.$inferSelect, userId: number) {
  const personal = event.ownerUserId !== null
  const editable = event.createdByUserId === userId
  return {
    id: event.id,
    name: event.name,
    eventDate: event.eventDate,
    isAllDay: event.isAllDay,
    startTime: event.startTime,
    endTime: event.endTime,
    recurrenceType: event.recurrenceType,
    notifyEnabled: event.notifyEnabled,
    defaultAmount: event.defaultAmount,
    showOnDashboard: event.showOnDashboard,
    personal,
    editable,
  }
}

export const eventsRoute = new Hono<AppEnv>()

eventsRoute.use('*', requireAuth)

eventsRoute.get('/', async (c) => {
  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  // 世帯共有(owner_user_id IS NULL)または自分が所有するイベントのみを表示する
  // (fixed-costs.tsのfindVisibleByHouseholdIdAndUserId相当のパターン)。
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.householdId, householdId), or(isNull(events.ownerUserId), eq(events.ownerUserId, userId))))
    .orderBy(events.id)
    .all()

  return c.json(rows.map((row) => toResponse(row, userId)))
})

eventsRoute.post('/', async (c) => {
  const parsed = eventSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '入力内容を確認してください'), 400)
  }

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const { name, eventDate, isAllDay, startTime, endTime, recurrenceType, notifyEnabled, defaultAmount, showOnDashboard, personal } =
    parsed.data
  const inserted = await db
    .insert(events)
    .values({
      householdId,
      ownerUserId: personal ? userId : null,
      createdByUserId: userId,
      name,
      eventDate,
      isAllDay: isAllDay ?? true,
      startTime: startTime ?? null,
      endTime: endTime ?? null,
      recurrenceType: recurrenceType ?? 'none',
      notifyEnabled: notifyEnabled ?? false,
      defaultAmount: defaultAmount ?? null,
      showOnDashboard: showOnDashboard ?? true,
    })
    .returning()
    .get()

  return c.json(toResponse(inserted, userId), 201)
})

eventsRoute.patch('/:id', async (c) => {
  const parsed = eventSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '入力内容を確認してください'), 400)
  }
  const eventId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  // 世帯共有のイベントであっても、編集・削除できるのは登録者(created_by_user_id)本人のみ
  // (fixed-costs.tsと同じ、common-notes.md 2章の権限方針)。
  const event = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.householdId, householdId), eq(events.createdByUserId, userId)))
    .get()
  if (!event) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  const { name, eventDate, isAllDay, startTime, endTime, recurrenceType, notifyEnabled, defaultAmount, showOnDashboard, personal } =
    parsed.data
  const ownerUserId = personal ? userId : null
  const updated = {
    ...event,
    name,
    eventDate,
    isAllDay: isAllDay ?? true,
    startTime: startTime ?? null,
    endTime: endTime ?? null,
    recurrenceType: recurrenceType ?? 'none',
    notifyEnabled: notifyEnabled ?? false,
    defaultAmount: defaultAmount ?? null,
    showOnDashboard: showOnDashboard ?? true,
    ownerUserId,
  }
  await db
    .update(events)
    .set({
      name: updated.name,
      eventDate: updated.eventDate,
      isAllDay: updated.isAllDay,
      startTime: updated.startTime,
      endTime: updated.endTime,
      recurrenceType: updated.recurrenceType,
      notifyEnabled: updated.notifyEnabled,
      defaultAmount: updated.defaultAmount,
      showOnDashboard: updated.showOnDashboard,
      ownerUserId: updated.ownerUserId,
    })
    .where(eq(events.id, eventId))

  return c.json(toResponse(updated, userId))
})

eventsRoute.delete('/:id', async (c) => {
  const eventId = Number(c.req.param('id'))

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  const event = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.householdId, householdId), eq(events.createdByUserId, userId)))
    .get()
  if (!event) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  await db.delete(events).where(eq(events.id, eventId))

  return c.body(null, 204)
})

eventsRoute.get('/:id/summary', async (c) => {
  const eventId = Number(c.req.param('id'))
  const period = c.req.query('period')
  if (period !== 'year' && period !== 'month') {
    return c.json(errorResponse('VALIDATION_ERROR', INVALID_PERIOD_MESSAGE), 400)
  }

  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const householdId = await resolveHouseholdId(db, userId)
  if (householdId === null) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', HOUSEHOLD_NOT_FOUND_MESSAGE), 404)
  }

  // 世帯共有/個人を問わず、閲覧できるイベント(自分に見えるイベント)であることを確認する。
  // F06ドキュメント3章「イベント別集計」のIPOは「show_on_dashboard = trueのイベントを対象に
  // 集計する」と明記しているため、この集計エンドポイント自体もその条件で絞り込む
  // (表示対象から外したイベントの集計は行わない)。
  const event = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.id, eventId),
        eq(events.householdId, householdId),
        eq(events.showOnDashboard, true),
        or(isNull(events.ownerUserId), eq(events.ownerUserId, userId)),
      ),
    )
    .get()
  if (!event) {
    return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  }

  // イベント別集計は公開範囲に関わらず「本人が支払った支出」のみを対象とする
  // (F06ドキュメント7-2章。支出データ自体が本人のみ閲覧可能なため)。
  const jstToday = getJstToday()
  let rangeStart: string
  let rangeEnd: string
  if (period === 'month') {
    const { monthStart, nextMonthStart } = currentMonthRange(jstToday)
    rangeStart = monthStart
    rangeEnd = nextMonthStart
  } else {
    const year = jstToday.getUTCFullYear()
    rangeStart = `${year}-01-01`
    rangeEnd = `${year + 1}-01-01`
  }

  const totalRow = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
     WHERE event_id = ? AND payer_user_id = ? AND expense_date >= ? AND expense_date < ?`,
  )
    .bind(eventId, userId, rangeStart, rangeEnd)
    .first<{ total: number }>()

  return c.json({ total: totalRow?.total ?? 0 })
})

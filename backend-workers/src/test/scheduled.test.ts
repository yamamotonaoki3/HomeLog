import { env } from 'cloudflare:test'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import app from '../index'
import * as accountDeletion from '../lib/account-deletion'
import * as demoCleanup from '../lib/demo-cleanup'
import { createDemoHousehold } from '../lib/demo-seed'
import * as fixedCostPosting from '../lib/fixed-cost-posting'
import * as consumption from '../lib/inventory-consumption'
import * as menuCleanup from '../lib/menu-entry-cleanup'
import * as passwordResetMail from '../lib/password-reset-mail'
import * as rateLimit from '../lib/rate-limit'

beforeEach(() => {
  vi.spyOn(menuCleanup, 'purgePastMenuEntries').mockResolvedValue(0)
})

afterEach(() => vi.restoreAllMocks())

it.each(['posting', 'cleanup'])('日次処理は%sが失敗しても残りを実行する', async (failure) => {
  const all = vi.fn().mockResolvedValue({ results: [] })
  const list = vi.fn().mockResolvedValue({ objects: [], truncated: false })
  const error = new Error('[E2E_TEST] 日次処理失敗')
  if (failure === 'posting') all.mockRejectedValue(error)
  else list.mockRejectedValue(error)
  const batch = vi.fn().mockResolvedValue([])
  const prepare = vi.fn().mockReturnValue({ bind: () => ({ all }) })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const bindings = {
    ...env,
    DB: { prepare, batch } as unknown as D1Database,
    RECIPE_IMAGES: { list } as unknown as R2Bucket,
  }

  await app.scheduled({ scheduledTime: Date.parse('2024-12-31T16:00:00Z') } as ScheduledController, bindings)

  // 固定費と退会削除は読み取り、在庫消費は固定2文のbatch。
  expect(all).toHaveBeenCalledTimes(2)
  expect(batch).toHaveBeenCalledTimes(1)
  expect(batch.mock.calls[0][0]).toHaveLength(2)
  expect(list).toHaveBeenCalledWith({ prefix: 'ocr/' })
  expect(log).toHaveBeenCalledWith('日次処理に失敗しました', error)
  expect(menuCleanup.purgePastMenuEntries).toHaveBeenCalledTimes(1)
})

it('遅延実行も予定時刻のJST日付を渡し、消費の失敗から他の日次処理を独立させる', async () => {
  const failure = new Error('[E2E_TEST] consumption failure')
  const consume = vi.spyOn(consumption, 'consumeInventoryForDate').mockRejectedValue(failure)
  const all = vi.fn().mockResolvedValue({ results: [] })
  const list = vi.fn().mockResolvedValue({ objects: [], truncated: false })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const bindings = { ...env, DB: { prepare: () => ({ bind: () => ({ all }) }) } as unknown as D1Database, RECIPE_IMAGES: { list } as unknown as R2Bucket }
  await app.scheduled({ scheduledTime: Date.parse('2024-12-31T16:00:00Z') } as ScheduledController, bindings)
  expect(consume).toHaveBeenCalledWith(bindings.DB, '2025-01-01')
  expect(all).toHaveBeenCalledTimes(2)
  expect(list).toHaveBeenCalled()
  expect(log).toHaveBeenCalledWith('日次処理に失敗しました', failure)
  expect(menuCleanup.purgePastMenuEntries).toHaveBeenCalledTimes(1)
})

it('JST 0時のCronは献立削除だけを実時刻で呼び出す', async () => {
  vi.useFakeTimers()
  try {
    const now = new Date('2026-10-25T15:10:00Z')
    vi.setSystemTime(now)
    const prepare = vi.fn(() => { throw new Error('他の日次処理を実行してはいけない') })
    const bindings = { ...env, DB: { prepare } as unknown as D1Database }
    const consume = vi.spyOn(consumption, 'consumeInventoryForDate')
    // 予定時刻が先週でも、実際に動いた今週が削除基準となる。
    await app.scheduled({ cron: '0 15 * * *', scheduledTime: Date.parse('2026-10-18T15:00:00Z') } as ScheduledController, bindings)
    expect(menuCleanup.purgePastMenuEntries).toHaveBeenCalledExactlyOnceWith(bindings.DB, now)
    expect(consume).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})

it.each(['0 15 * * *', '0 16 * * *'])('献立削除が失敗しても隔離する（%s）', async (cron) => {
  const failure = new Error('[E2E_TEST] cleanup failure')
  vi.mocked(menuCleanup.purgePastMenuEntries).mockRejectedValue(failure)
  const consume = vi.spyOn(consumption, 'consumeInventoryForDate').mockResolvedValue(undefined)
  const all = vi.fn().mockResolvedValue({ results: [] })
  const list = vi.fn().mockResolvedValue({ objects: [], truncated: false })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const bindings = { ...env, DB: { prepare: () => ({ bind: () => ({ all }) }) } as unknown as D1Database, RECIPE_IMAGES: { list } as unknown as R2Bucket }
  await app.scheduled({ cron, scheduledTime: Date.parse('2026-10-25T16:00:00Z') } as ScheduledController, bindings)
  expect(menuCleanup.purgePastMenuEntries).toHaveBeenCalledTimes(1)
  expect(log).toHaveBeenCalledWith('日次処理に失敗しました', failure)
  if (cron === '0 16 * * *') {
    expect(consume).toHaveBeenCalledTimes(1)
    expect(all).toHaveBeenCalledTimes(2)
    expect(list).toHaveBeenCalled()
  } else {
    expect(consume).not.toHaveBeenCalled()
    expect(all).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  }
})

it('パスワード再設定の回数制限の清掃は、JST 1時の日次処理でだけ実行する', async () => {
  const purge = vi.spyOn(passwordResetMail, 'purgePasswordResetAttempts').mockResolvedValue(0)
  const all = vi.fn().mockResolvedValue({ results: [] })
  const list = vi.fn().mockResolvedValue({ objects: [], truncated: false })
  const bindings = { ...env, DB: { prepare: () => ({ bind: () => ({ all }) }), batch: vi.fn().mockResolvedValue([]) } as unknown as D1Database, RECIPE_IMAGES: { list } as unknown as R2Bucket }
  await app.scheduled({ cron: '0 15 * * *', scheduledTime: Date.parse('2024-12-31T15:00:00Z') } as ScheduledController, bindings)
  expect(purge).not.toHaveBeenCalled()
  await app.scheduled({ cron: '0 16 * * *', scheduledTime: Date.parse('2024-12-31T16:00:00Z') } as ScheduledController, bindings)
  expect(purge).toHaveBeenCalledTimes(1)
  expect(purge).toHaveBeenCalledWith(bindings.DB)
})

it('認証・画像解析の回数制限の清掃は、JST 1時の日次処理でだけ実行する (#510)', async () => {
  const purge = vi.spyOn(rateLimit, 'purgeRateLimits').mockResolvedValue(0)
  const all = vi.fn().mockResolvedValue({ results: [] })
  const list = vi.fn().mockResolvedValue({ objects: [], truncated: false })
  const bindings = { ...env, DB: { prepare: () => ({ bind: () => ({ all }) }), batch: vi.fn().mockResolvedValue([]) } as unknown as D1Database, RECIPE_IMAGES: { list } as unknown as R2Bucket }
  await app.scheduled({ cron: '0 15 * * *', scheduledTime: Date.parse('2024-12-31T15:00:00Z') } as ScheduledController, bindings)
  expect(purge).not.toHaveBeenCalled()
  await app.scheduled({ cron: '0 16 * * *', scheduledTime: Date.parse('2024-12-31T16:00:00Z') } as ScheduledController, bindings)
  expect(purge).toHaveBeenCalledTimes(1)
  expect(purge).toHaveBeenCalledWith(bindings.DB)
})

// ---- デモ環境の毎時Cron(#532) ----
const HOURLY_CRON = '0 * * * *'

it('毎時のCron(0 * * * *)は期限切れのデモの削除だけを行い、日次処理は動かさない', async () => {
  const purge = vi.spyOn(demoCleanup, 'purgeExpiredDemos').mockResolvedValue(0)
  const consume = vi.spyOn(consumption, 'consumeInventoryForDate')
  const posting = vi.spyOn(fixedCostPosting, 'postDueFixedCosts')
  const accounts = vi.spyOn(accountDeletion, 'purgeExpiredAccounts')
  const resetAttempts = vi.spyOn(passwordResetMail, 'purgePasswordResetAttempts')
  const limits = vi.spyOn(rateLimit, 'purgeRateLimits')
  const list = vi.fn().mockResolvedValue({ objects: [], truncated: false })
  const prepare = vi.fn(() => { throw new Error('他の処理がDBに触れてはいけない') })
  const bindings = { ...env, DB: { prepare } as unknown as D1Database, RECIPE_IMAGES: { list } as unknown as R2Bucket }
  await app.scheduled({ cron: HOURLY_CRON, scheduledTime: Date.parse('2026-11-14T05:00:00Z') } as ScheduledController, bindings)
  expect(purge).toHaveBeenCalledTimes(1)
  expect(purge.mock.calls[0][0]).toBe(bindings.DB)
  for (const other of [consume, posting, accounts, resetAttempts, limits]) expect(other).not.toHaveBeenCalled()
  expect(menuCleanup.purgePastMenuEntries).not.toHaveBeenCalled()
  expect(list).not.toHaveBeenCalled()
  expect(prepare).not.toHaveBeenCalled()
})

it('毎時のCronで削除が失敗しても例外にせず、ログだけ残す', async () => {
  const failure = new Error('[E2E_TEST] demo cleanup failure')
  vi.spyOn(demoCleanup, 'purgeExpiredDemos').mockRejectedValue(failure)
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  await app.scheduled({ cron: HOURLY_CRON, scheduledTime: Date.now() } as ScheduledController, { ...env })
  expect(log).toHaveBeenCalledWith('期限切れのデモの削除に失敗しました', failure)
})

it('毎時のCronで、期限切れのデモが実際にDBから消え、期限内のデモは残る', async () => {
  await env.DB.batch(['demo_households', 'household_members', 'households', 'users'].map((table) => env.DB.prepare(`DELETE FROM ${table}`)))
  const expired = await createDemoHousehold(env.DB, new Date(Date.now() - 25 * 3_600_000))
  const active = await createDemoHousehold(env.DB, new Date())
  await app.scheduled({ cron: HOURLY_CRON, scheduledTime: Date.now() } as ScheduledController, { ...env })
  const rows = await env.DB.prepare('SELECT household_id AS id FROM demo_households').all<{ id: number }>()
  expect(rows.results).toEqual([{ id: active.householdId }])
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE id IN (?, ?)').bind(expired.primaryUserId, expired.partnerUserId).first()).toEqual({ n: 0 })
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM households').first()).toEqual({ n: 1 })
})

it('R2(RECIPE_IMAGES)が無いデモ環境で毎日の処理(0 16)を実行しても、エラーが記録されない', async () => {
  vi.spyOn(consumption, 'consumeInventoryForDate').mockResolvedValue(undefined)
  vi.spyOn(passwordResetMail, 'purgePasswordResetAttempts').mockResolvedValue(0)
  vi.spyOn(rateLimit, 'purgeRateLimits').mockResolvedValue(0)
  const all = vi.fn().mockResolvedValue({ results: [] })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const bindings = { ...env, DB: { prepare: () => ({ bind: () => ({ all }) }), batch: vi.fn().mockResolvedValue([]) } as unknown as D1Database, RECIPE_IMAGES: undefined }
  await app.scheduled({ cron: '0 16 * * *', scheduledTime: Date.parse('2026-11-14T16:00:00Z') } as ScheduledController, bindings as unknown as typeof env)
  expect(log).not.toHaveBeenCalled()
  expect(all).toHaveBeenCalledTimes(2)
})

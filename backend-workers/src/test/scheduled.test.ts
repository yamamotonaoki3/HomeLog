import { env } from 'cloudflare:test'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import app from '../index'
import * as consumption from '../lib/inventory-consumption'
import * as menuCleanup from '../lib/menu-entry-cleanup'

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

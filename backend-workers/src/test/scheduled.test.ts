import { env } from 'cloudflare:test'
import { afterEach, expect, it, vi } from 'vitest'
import app from '../index'

afterEach(() => vi.restoreAllMocks())

it.each(['posting', 'cleanup'])('日次処理は%sが失敗しても両方を実行する', async (failure) => {
  const all = vi.fn().mockResolvedValue({ results: [] })
  const list = vi.fn().mockResolvedValue({ objects: [], truncated: false })
  const error = new Error('[E2E_TEST] 日次処理失敗')
  if (failure === 'posting') all.mockRejectedValue(error)
  else list.mockRejectedValue(error)
  const prepare = vi.fn().mockReturnValue({ bind: () => ({ all }) })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const bindings = {
    ...env,
    DB: { prepare } as unknown as D1Database,
    RECIPE_IMAGES: { list } as unknown as R2Bucket,
  }

  await app.scheduled({} as ScheduledController, bindings)

  expect(all).toHaveBeenCalledTimes(1)
  expect(list).toHaveBeenCalledWith({ prefix: 'ocr/' })
  expect(log).toHaveBeenCalledWith('日次処理に失敗しました', error)
})

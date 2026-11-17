import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { savePending, readPending, removePending, pendingKey, type PurchasePending } from '../../lib/shoppingPending'

const scope = { actorUserId: 1, householdId: 10 }
const request = { requestId: '12345678-1234-4234-8234-123456789abc', items: [{ id: 11, purchasedQuantity: 2, expectedPurchaseRevision: 3 }] }
let locked = false
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('navigator', { locks: { request: vi.fn(async (_name, _options, callback) => { locked = true; try { return callback() } finally { locked = false } }) } })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('排他内に秘密を含まないsnapshotを保存し読み戻し、呼出側変更から独立させる', async () => {
  const body = structuredClone(request)
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) { expect(locked).toBe(true); originalSet.call(this, key, value) })
  const result = await savePending(scope, body, () => true)
  body.items[0].purchasedQuantity = 9
  expect(result.kind).toBe('saved')
  expect(readPending(scope)).toMatchObject({ kind: 'pending', pending: { ...scope, ...request, version: 1 } })
  expect(spy).toHaveBeenCalledOnce()
  expect(Object.keys(JSON.parse(localStorage.getItem(pendingKey(scope))!)).sort()).toEqual(['actorUserId','createdAt','householdId','items','requestId','version'])
})
const originalSet = Storage.prototype.setItem
it('既存pendingを上書きせず別scopeは読まない', async () => {
  await savePending(scope, request, () => true)
  expect((await savePending(scope, { ...request, requestId: '22345678-1234-4234-8234-123456789abc' }, () => true)).kind).toBe('existing')
  expect(readPending({ ...scope, actorUserId: 2 })).toEqual({ kind: 'empty' })
})
it.each(['{', JSON.stringify({ version: 2 }), JSON.stringify({ ...scope, ...request, version: 1, createdAt: 'bad' })])('壊れた保存を上書きしない: %s', async (raw) => {
  localStorage.setItem(pendingKey(scope), raw)
  expect(readPending(scope).kind).toBe('corrupt')
  expect((await savePending(scope, request, () => true)).kind).toBe('blocked')
  expect(localStorage.getItem(pendingKey(scope))).toBe(raw)
})
it('Web Locks非対応・取得拒否・storage例外・readback不一致は保存完了しない', async () => {
  vi.stubGlobal('navigator', {})
  expect((await savePending(scope, request, () => true)).kind).toBe('blocked')
  vi.stubGlobal('navigator', { locks: { request: vi.fn().mockRejectedValue(new Error('denied')) } })
  expect((await savePending(scope, request, () => true)).kind).toBe('blocked')
  vi.stubGlobal('navigator', { locks: { request: async (_n: string, _o: unknown, callback: () => unknown) => callback() } })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  expect((await savePending(scope, request, () => true)).kind).toBe('blocked')
  vi.restoreAllMocks()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})
  expect((await savePending(scope, request, () => true)).kind).toBe('blocked')
})
it('scope無効なら保存せず、一致するkeyと順序bodyだけを削除する', async () => {
  expect((await savePending(scope, request, () => false)).kind).toBe('blocked')
  const result = await savePending(scope, request, () => true)
  if (result.kind !== 'saved') throw new Error('not saved')
  const pending: PurchasePending = result.pending
  expect(await removePending(pending, () => true)).toBe(true)
  await savePending(scope, { ...request, requestId: '22345678-1234-4234-8234-123456789abc' }, () => true)
  expect(await removePending(pending, () => true)).toBe(false)
  expect(readPending(scope).kind).toBe('pending')
})
it('保存の数量・ID・revisionを検証して無効bodyを保存しない', async () => {
  for (const line of [{ id: 0, purchasedQuantity: 2, expectedPurchaseRevision: 3 }, { id: 1, purchasedQuantity: 0.01, expectedPurchaseRevision: 3 }, { id: 1, purchasedQuantity: 1, expectedPurchaseRevision: -1 }]) {
    expect((await savePending(scope, { ...request, items: [line] }, () => true)).kind).toBe('blocked')
  }
})

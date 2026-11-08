import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { useShoppingPurchases } from '../../hooks/useShoppingPurchases'
import { setTokens, setAccessToken, clearTokens, getAccessToken } from '../../api/tokenStorage'
import { pendingKey, readPending, savePending } from '../../lib/shoppingPending'
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
const scope = { actorUserId: 1, householdId: 10 }
const lines = [{ id: 11, purchasedQuantity: 2, expectedPurchaseRevision: 3 }]
const response = (id: string) => ({ requestId: id, updatedInventoryItems: [{ id: 21, quantity: 4 }], removedShoppingListItemIds: [], remainingShoppingListItems: [{ id: 11, plannedQuantity: 1, purchaseRevision: 4 }] })
const callbacks = () => ({ actorUserId: 1, onSuccess: vi.fn().mockResolvedValue(undefined), onNotApplied: vi.fn().mockResolvedValue(undefined), onDetached: vi.fn() })
it.each(['missingCredentials', 'invalidIdentity'] as const)('初回未検証の購入は切り離すが確立済み世帯の失効として通知しない: %s', async (failure) => {
  if (failure === 'missingCredentials') clearTokens()
  else server.use(http.get('/api/auth/me', () => HttpResponse.json({})))
  let posts = 0
  server.use(http.post('/api/shopping-list-items/purchases', () => { posts++; return HttpResponse.json({}) }))
  const options = callbacks(), { result } = renderHook(() => useShoppingPurchases(options))
  await waitFor(() => expect(result.current.status).toBe('detached'))
  expect(result.current.isolated).toBe(true)
  expect(result.current.scope).toBeNull(); expect(result.current.pending).toBeNull()
  expect(options.onDetached).toHaveBeenCalledWith(false)
  await act(async () => { await result.current.confirm(lines); await result.current.recover() })
  expect(posts).toBe(0); expect(options.onSuccess).not.toHaveBeenCalled()
})

it('actor確定によるscopeリセット後の失敗でも以前の確認済み世帯を失効させる', async () => {
  const options = callbacks()
  const { result, rerender } = renderHook(({ actor }) => useShoppingPurchases({ ...options, actorUserId: actor }), { initialProps: { actor: undefined as number | undefined } })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  await act(async () => { clearTokens(); rerender({ actor: 1 }) })
  await waitFor(() => expect(result.current.status).toBe('detached'))
  expect(result.current.scope).toBeNull(); expect(result.current.isolated).toBe(true)
  expect(options.onDetached).toHaveBeenCalledOnce(); expect(options.onDetached).toHaveBeenCalledWith(true)
})

it('未検証のままでも既知actorが変われば新本人の確認完了前に世帯を隔離する', async () => {
  clearTokens()
  const options = callbacks(), entered = deferred(), release = deferred()
  const { result, rerender } = renderHook(({ actor }) => useShoppingPurchases({ ...options, actorUserId: actor }), { initialProps: { actor: 1 } })
  await waitFor(() => expect(result.current.status).toBe('detached'))
  options.onDetached.mockClear()
  server.use(http.get('/api/auth/me', async () => { entered.resolve(); await release.promise; return HttpResponse.json({ id: 2 }) }))
  try {
    await act(async () => { setTokens('testuser_b_access', 'testuser_b_refresh'); rerender({ actor: 2 }) })
    await act(async () => { await entered.promise })
    expect(options.onDetached).toHaveBeenCalledOnce(); expect(options.onDetached).toHaveBeenCalledWith(true)
    expect(result.current.isolated).toBe(true); expect(result.current.scope).toBeNull()
  } finally { await act(async () => { release.resolve() }) }
})

it('idle中の同session access更新後は新pairで本人と世帯を確認して購入する', async () => {
  const options = callbacks(), requests: { path: string; authorization: string | null }[] = []
  server.use(
    http.get('/api/auth/me', ({ request }) => { requests.push({ path: 'actor', authorization: request.headers.get('Authorization') }); return HttpResponse.json({ id: 1 }) }),
    http.get('/api/households/me', ({ request }) => { requests.push({ path: 'household', authorization: request.headers.get('Authorization') }); return HttpResponse.json({ id: 10 }) }),
    http.post('/api/shopping-list-items/purchases', async ({ request }) => { requests.push({ path: 'purchase', authorization: request.headers.get('Authorization') }); const body = await request.json() as { requestId: string }; return HttpResponse.json(response(body.requestId)) }),
  )
  const { result } = renderHook(() => useShoppingPurchases(options))
  await waitFor(() => expect(result.current.status).toBe('ready'))
  requests.length = 0
  await act(async () => { setAccessToken('testuser_a_rotated_access'); await result.current.confirm(lines) })
  expect(requests).toEqual(['actor', 'household', 'purchase'].map(path => ({ path, authorization: 'Bearer testuser_a_rotated_access' })))
  expect(options.onSuccess).toHaveBeenCalledOnce()
  expect(options.onDetached).not.toHaveBeenCalled()
  expect(result.current.status).toBe('ready')
  expect(readPending(scope).kind).toBe('empty')
})
it('購入前の本人再確認中にaccessが更新されたらPOSTせずdraft破棄なしで明示再試行できる', async () => {
  let entered!: () => void, release!: () => void, posts = 0
  const arrived = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  const options = callbacks(), { result } = renderHook(() => useShoppingPurchases(options))
  await waitFor(() => expect(result.current.status).toBe('ready'))
  server.use(
    http.get('/api/auth/me', async () => { entered(); await gate; return HttpResponse.json({ id: 1 }) }),
    http.post('/api/shopping-list-items/purchases', async ({ request }) => { posts++; const body = await request.json() as { requestId: string }; return HttpResponse.json(response(body.requestId)) }),
  )
  let sending!: Promise<void>
  act(() => { sending = result.current.confirm(lines) })
  await act(async () => { await arrived })
  await act(async () => { setAccessToken('testuser_a_rotated_access'); release(); await sending })
  expect(posts).toBe(0)
  expect(options.onDetached).not.toHaveBeenCalled()
  expect(options.onSuccess).not.toHaveBeenCalled()
  expect(readPending(scope).kind).toBe('empty')
  await act(async () => { await result.current.recheck() })
  await act(async () => { await result.current.confirm(lines) })
  expect(posts).toBe(1)
  expect(options.onSuccess).toHaveBeenCalledOnce()
  expect(options.onDetached).not.toHaveBeenCalled()
})
it('POST中の同session access更新では旧成功を採用せずpendingを保持して明示同key回復する', async () => {
  let entered!: () => void, release!: () => void
  const arrived = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  const bodies: unknown[] = [], authorizations: (string | null)[] = [], options = callbacks()
  server.use(http.post('/api/shopping-list-items/purchases', async ({ request }) => {
    const body = await request.json() as { requestId: string }; bodies.push(body); authorizations.push(request.headers.get('Authorization'))
    if (bodies.length === 1) { entered(); await gate }
    return HttpResponse.json(response(body.requestId))
  }))
  const { result } = renderHook(() => useShoppingPurchases(options))
  await waitFor(() => expect(result.current.status).toBe('ready'))
  let sending!: Promise<void>
  act(() => { sending = result.current.confirm(lines) })
  await act(async () => { await arrived })
  const saved = localStorage.getItem(pendingKey(scope))
  expect(saved).not.toBeNull()
  await act(async () => { setAccessToken('testuser_a_rotated_access'); release(); await sending })
  expect(options.onSuccess).not.toHaveBeenCalled()
  expect(options.onDetached).not.toHaveBeenCalled()
  expect(localStorage.getItem(pendingKey(scope))).toBe(saved)
  await act(async () => { await result.current.recheck() })
  expect(result.current.status).toBe('unknown')
  expect(result.current.pending?.items).toEqual(lines)
  expect(bodies).toHaveLength(1)
  await act(async () => { await result.current.recover() })
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toEqual(bodies[0])
  expect(authorizations).toEqual(['Bearer testuser_a_access', 'Bearer testuser_a_rotated_access'])
  expect(options.onSuccess).toHaveBeenCalledOnce()
  expect(options.onDetached).not.toHaveBeenCalled()
  expect(readPending(scope).kind).toBe('empty')
})
beforeEach(() => {
  localStorage.clear(); setTokens('testuser_a_access','testuser_a_refresh')
  vi.stubGlobal('isSecureContext', true)
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, callback: () => unknown) => callback() } })
  server.use(http.get('/api/auth/me', () => HttpResponse.json({ id: 1 })), http.get('/api/households/me', () => HttpResponse.json({ id: 10 })))
})
afterEach(() => { clearTokens(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it.each([
  { trigger: 'storage', failRefresh: false }, { trigger: 'storage', failRefresh: true },
  { trigger: 'recover', failRefresh: false }, { trigger: 'recover', failRefresh: true },
  { trigger: 'recheck', failRefresh: false }, { trigger: 'recheck', failRefresh: true },
] as const)('観測済みpendingの消失は自画面のGET完了まで新規購入を止める: $trigger / GET失敗=$failRefresh', async ({ trigger, failRefresh }) => {
  const original = { requestId: '12345678-1234-4234-8234-123456789abc', items: lines }
  expect((await savePending(scope, original, () => true)).kind).toBe('saved')
  const gate = deferred(), onResolvedElsewhere = vi.fn(async () => {
    await gate.promise
    if (failRefresh) throw new Error('[E2E_TEST] list GET failed')
  })
  // An external deletion carries no success/NOT_APPLIED response. Only our own GET can synchronize rows.
  const options = { ...callbacks(), onResolvedElsewhere }
  let posts = 0
  server.use(http.post('/api/shopping-list-items/purchases', () => { posts++; return HttpResponse.json({}, { status: 503 }) }))
  const { result } = renderHook(() => useShoppingPurchases(options))
  await waitFor(() => expect(result.current.status).toBe('unknown'))
  expect(result.current.pending).toMatchObject(original)
  const key = pendingKey(scope), oldValue = localStorage.getItem(key)
  const deletion = () => window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue: null, storageArea: localStorage }))
  let synchronizing: Promise<void> | undefined
  try {
    act(() => {
      localStorage.removeItem(key)
      if (trigger === 'storage') deletion()
      else synchronizing = result.current[trigger]()
    })
    await waitFor(() => expect(onResolvedElsewhere).toHaveBeenCalledOnce())
    expect(['ready', 'notApplied']).not.toContain(result.current.status)
    await act(async () => { deletion(); await result.current.recheck(); await result.current.confirm(lines); await result.current.recover() })
    expect(onResolvedElsewhere).toHaveBeenCalledOnce()
    expect(['ready', 'notApplied']).not.toContain(result.current.status)
    expect(posts).toBe(0); expect(readPending(scope).kind).toBe('empty')
    expect(options.onSuccess).not.toHaveBeenCalled(); expect(options.onNotApplied).not.toHaveBeenCalled()
    await act(async () => { gate.resolve(); await synchronizing })
    if (failRefresh) {
      await waitFor(() => expect(result.current.message).toMatch(/一覧.*再取得/))
      expect(['ready', 'notApplied']).not.toContain(result.current.status)
      expect(result.current.message).not.toMatch(/購入.*反映済|購入を反映しました/)
      await act(async () => { deletion(); await result.current.confirm(lines); await result.current.recover() })
      expect(onResolvedElsewhere).toHaveBeenCalledOnce()
    } else await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(posts).toBe(0); expect(options.onDetached).not.toHaveBeenCalled()
    expect(options.onSuccess).not.toHaveBeenCalled(); expect(options.onNotApplied).not.toHaveBeenCalled()
  } finally { await act(async () => { gate.resolve(); await synchronizing }) }
})

it('未確認pendingを観測していない空storageイベントではGETも購入も始めない', async () => {
  const options = { ...callbacks(), onResolvedElsewhere: vi.fn().mockResolvedValue(undefined) }
  let posts = 0
  server.use(http.post('/api/shopping-list-items/purchases', () => { posts++; return HttpResponse.json({}) }))
  const { result } = renderHook(() => useShoppingPurchases(options))
  await waitFor(() => expect(result.current.status).toBe('ready'))
  await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: pendingKey(scope), oldValue: null, newValue: null, storageArea: localStorage })) })
  expect(result.current.status).toBe('ready'); expect(result.current.pending).toBeNull()
  expect(options.onResolvedElsewhere).not.toHaveBeenCalled(); expect(posts).toBe(0)
  expect(options.onSuccess).not.toHaveBeenCalled(); expect(options.onNotApplied).not.toHaveBeenCalled()
})

it.each(['newKey', 'corrupt', 'blocked'] as const)('別tabの削除通知でも現在の保存内容が空でなければ旧pendingの同期で消費しない: %s', async (change) => {
  expect((await savePending(scope, { requestId: '12345678-1234-4234-8234-123456789abc', items: lines }, () => true)).kind).toBe('saved')
  const options = { ...callbacks(), onResolvedElsewhere: vi.fn().mockResolvedValue(undefined) }
  let posts = 0
  server.use(http.post('/api/shopping-list-items/purchases', () => { posts++; return HttpResponse.json({}) }))
  const { result } = renderHook(() => useShoppingPurchases(options))
  await waitFor(() => expect(result.current.status).toBe('unknown'))
  const key = pendingKey(scope), oldValue = localStorage.getItem(key)
  const replacement = { ...JSON.parse(oldValue!), requestId: '22345678-1234-4234-8234-123456789abc', items: [{ ...lines[0], expectedPurchaseRevision: 4 }] }
  if (change === 'newKey') localStorage.setItem(key, JSON.stringify(replacement))
  if (change === 'corrupt') localStorage.setItem(key, '{invalid [E2E_TEST]')
  const stored = localStorage.getItem(key), read = Storage.prototype.getItem
  const unreadable = change === 'blocked' ? vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, name: string) {
    if (name === key) throw new Error('[E2E_TEST] storage unavailable')
    return read.call(this, name)
  }) : undefined
  try {
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue: null, storageArea: localStorage })) })
    expect(result.current.status).toBe(change === 'newKey' ? 'unknown' : change)
    if (change === 'newKey') expect(result.current.pending).toMatchObject(replacement)
    await act(async () => { await result.current.confirm(lines) })
    expect(posts).toBe(0); expect(options.onResolvedElsewhere).not.toHaveBeenCalled()
    expect(options.onSuccess).not.toHaveBeenCalled(); expect(options.onNotApplied).not.toHaveBeenCalled()
  } finally { unreadable?.mockRestore() }
  expect(localStorage.getItem(key)).toBe(stored)
})

it.each(['otherScope', 'access', 'session', 'actor'] as const)('別scopeや別credentialsのstorage通知で旧pendingの同期callbackを呼ばない: %s', async (change) => {
  expect((await savePending(scope, { requestId: '12345678-1234-4234-8234-123456789abc', items: lines }, () => true)).kind).toBe('saved')
  const options = { ...callbacks(), onResolvedElsewhere: vi.fn().mockResolvedValue(undefined) }
  let posts = 0
  server.use(http.post('/api/shopping-list-items/purchases', () => { posts++; return HttpResponse.json({}) }))
  const { result, rerender } = renderHook(({ actor }) => useShoppingPurchases({ ...options, actorUserId: actor }), { initialProps: { actor: 1 } })
  await waitFor(() => expect(result.current.status).toBe('unknown'))
  const key = pendingKey(scope), oldValue = localStorage.getItem(key)
  if (change === 'actor') {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ id: 2 })))
    await act(async () => { setTokens('testuser_b_access', 'testuser_b_refresh'); rerender({ actor: 2 }) })
    await waitFor(() => expect(result.current.scope?.actorUserId).toBe(2))
  }
  await act(async () => {
    if (change === 'access') setAccessToken('testuser_a_rotated_access')
    if (change === 'session') setTokens('testuser_b_access', 'testuser_b_refresh')
    if (change !== 'otherScope') localStorage.removeItem(key)
    window.dispatchEvent(new StorageEvent('storage', { key: change === 'otherScope' ? pendingKey({ actorUserId: 1, householdId: 20 }) : key, oldValue, newValue: null, storageArea: localStorage }))
  })
  expect(options.onResolvedElsewhere).not.toHaveBeenCalled()
  expect(options.onSuccess).not.toHaveBeenCalled(); expect(options.onNotApplied).not.toHaveBeenCalled(); expect(posts).toBe(0)
  if (change === 'otherScope') {
    expect(result.current.status).toBe('unknown'); expect(localStorage.getItem(key)).toBe(oldValue)
  } else if (change !== 'actor') expect(['ready', 'notApplied']).not.toContain(result.current.status)
})

it('確認後保存済bodyだけを1回送信し対象を成功callbackへ渡す', async () => {
  const options = callbacks(); let posts = 0
  server.use(http.post('/api/shopping-list-items/purchases', async ({ request }) => { posts++; const body = await request.json() as { requestId: string }; expect(readPending(scope).kind).toBe('pending'); return HttpResponse.json(response(body.requestId)) }))
  const { result } = renderHook(() => useShoppingPurchases(options))
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(posts).toBe(0)
  await act(async () => { await Promise.all([result.current.confirm(lines),result.current.confirm(lines)]) })
  expect(posts).toBe(1)
  expect(options.onSuccess).toHaveBeenCalledOnce()
  expect(options.onSuccess.mock.calls[0][0].items).toEqual(lines)
  expect(readPending(scope).kind).toBe('empty')
})
it('500の元key/bodyはreload後も自動送信せず明示回復する', async () => {
  const bodies: unknown[] = []; let fail = true
  server.use(http.post('/api/shopping-list-items/purchases', async ({ request }) => { const body = await request.json() as { requestId: string }; bodies.push(body); return fail ? HttpResponse.json({}, { status: 503 }) : HttpResponse.json(response(body.requestId)) }))
  const first = renderHook(() => useShoppingPurchases(callbacks()))
  await waitFor(() => expect(first.result.current.status).toBe('ready'))
  await act(async () => { await first.result.current.confirm(lines) })
  expect(first.result.current.status).toBe('unknown'); first.unmount(); fail = false
  const second = renderHook(() => useShoppingPurchases(callbacks()))
  await waitFor(() => expect(second.result.current.status).toBe('unknown'))
  expect(bodies).toHaveLength(1)
  await act(async () => { await second.result.current.recover() })
  expect(bodies).toHaveLength(2); expect(bodies[0]).toEqual(bodies[1])
})
it.each([[400,'VALIDATION_ERROR'],[404,'RESOURCE_NOT_FOUND'],[409,'RESOURCE_CONFLICT']] as const)('保存terminal拒否はpending解決し再確認を要求する: %s', async (status, code) => {
  server.use(http.post('/api/shopping-list-items/purchases', () => HttpResponse.json({ code, details: [{ field: 'purchase', reason: 'PURCHASE_NOT_APPLIED' }] }, { status })))
  const options = callbacks(), { result } = renderHook(() => useShoppingPurchases(options))
  await waitFor(() => expect(result.current.status).toBe('ready'))
  await act(async () => { await result.current.confirm(lines) })
  expect(readPending(scope).kind).toBe('empty'); expect(result.current.status).toBe('notApplied'); expect(options.onNotApplied).toHaveBeenCalledOnce(); expect(options.onSuccess).not.toHaveBeenCalled()
})
it.each([400,404,409,401,503])('marker無し・未知応答はpendingを保持して新keyを作らない: %s', async (status) => {
  let posts = 0
  server.use(http.post('/api/shopping-list-items/purchases', () => { posts++; return HttpResponse.json({ code: 'UNKNOWN' }, { status }) }))
  const { result } = renderHook(() => useShoppingPurchases(callbacks()))
  await waitFor(() => expect(result.current.status).toBe('ready'))
  await act(async () => { await result.current.confirm(lines) })
  const saved = localStorage.getItem(pendingKey(scope))
  await act(async () => { await result.current.confirm(lines) })
  expect(posts).toBe(1); expect(localStorage.getItem(pendingKey(scope))).toBe(saved)
})
it('storage保存不能なら購入POST0', async () => {
  let posts = 0
  server.use(http.post('/api/shopping-list-items/purchases', () => { posts++; return HttpResponse.json({}) }))
  const { result } = renderHook(() => useShoppingPurchases(callbacks()))
  await waitFor(() => expect(result.current.status).toBe('ready'))
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(() => { throw new Error('quota') })
  await act(async () => { await result.current.confirm(lines) })
  expect(posts).toBe(0); expect(result.current.status).toBe('blocked')
})
it.each([200,401])('A応答前にBへ切替後は成功通知・削除・refresh・Btoken破棄0: %s', async (status) => {
  let release!: () => void, received!: () => void, refreshes = 0
  const wait = new Promise<void>(r => { release = r }), arrived = new Promise<void>(r => { received = r })
  server.use(http.post('/api/shopping-list-items/purchases', async ({ request }) => { const body = await request.json() as { requestId: string }; received(); await wait; return HttpResponse.json(status === 200 ? response(body.requestId) : {}, { status }) }), http.post('/api/auth/refresh', () => { refreshes++; return HttpResponse.json({}) }))
  const options = callbacks(), { result } = renderHook(() => useShoppingPurchases(options))
  await waitFor(() => expect(result.current.status).toBe('ready'))
  let sending!: Promise<void>
  act(() => { sending = result.current.confirm(lines) })
  await act(async () => { await arrived })
  await act(async () => { setTokens('testuser_b_access','testuser_b_refresh'); release(); await sending })
  expect(options.onSuccess).not.toHaveBeenCalled(); expect(readPending(scope).kind).toBe('pending'); expect(refreshes).toBe(0); expect(getAccessToken() === 'testuser_b_access').toBe(true); expect(result.current.status).toBe('detached')
})
it('成功後の一覧取得失敗は反映済みと区別しPOSTを再送しない', async () => {
  let posts = 0
  server.use(http.post('/api/shopping-list-items/purchases', async ({ request }) => { posts++; const body = await request.json() as { requestId: string }; return HttpResponse.json(response(body.requestId)) }))
  const options = callbacks(); options.onSuccess.mockRejectedValue(new Error('GET failed'))
  const { result } = renderHook(() => useShoppingPurchases(options))
  await waitFor(() => expect(result.current.status).toBe('ready'))
  await act(async () => { await result.current.confirm(lines) })
  expect(result.current.status).toBe('refreshFailed'); expect(posts).toBe(1)
})
it('既存pendingがあれば新しい確定は送らず元bodyを保持', async () => {
  await savePending(scope, { requestId: '12345678-1234-4234-8234-123456789abc', items: lines }, () => true)
  const { result } = renderHook(() => useShoppingPurchases(callbacks()))
  await waitFor(() => expect(result.current.status).toBe('unknown'))
  expect(result.current.pending?.items).toEqual(lines)
})

it('元pendingがあってもWeb Locksを利用できない回復はPOST0', async () => {
 await savePending(scope,{requestId:'12345678-1234-4234-8234-123456789abc',items:lines},()=>true)
 let posts=0;server.use(http.post('/api/shopping-list-items/purchases',()=>{posts++;return HttpResponse.json({})}))
 const {result}=renderHook(()=>useShoppingPurchases(callbacks()));await waitFor(()=>expect(result.current.status).toBe('unknown'))
 Object.defineProperty(navigator,'locks',{configurable:true,value:undefined})
 await act(async()=>{await result.current.recover()});expect(posts).toBe(0);expect(readPending(scope).kind).toBe('pending')
})
it('購入前のfresh世帯が変わったら古い画面とpending表示を切離す',async()=>{
 const options=callbacks(),{result}=renderHook(()=>useShoppingPurchases(options));await waitFor(()=>expect(result.current.status).toBe('ready'))
 server.use(http.get('/api/households/me',()=>HttpResponse.json({id:20})))
 await act(async()=>{await result.current.confirm(lines)})
 expect(result.current.status).toBe('detached');expect(options.onDetached).toHaveBeenCalledOnce()
 expect(result.current.isolated).toBe(true);expect(options.onDetached).toHaveBeenCalledWith(true)
})
it('WebLock待機中にtoken組が変わると保存とPOSTを開始しない',async()=>{
 let acquired!:()=>void,release!:()=>void,posts=0;const queued=new Promise<void>(r=>{acquired=r}),gate=new Promise<void>(r=>{release=r})
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_n:string,_o:unknown,cb:()=>unknown)=>{acquired();await gate;return cb()}}})
 server.use(http.post('/api/shopping-list-items/purchases',()=>{posts++;return HttpResponse.json({})}))
 const {result}=renderHook(()=>useShoppingPurchases(callbacks()));await waitFor(()=>expect(result.current.status).toBe('ready'))
 let sending!:Promise<void>;act(()=>{sending=result.current.confirm(lines)});await act(async()=>{await queued})
 await act(async()=>{setTokens('testuser_a_new_access','testuser_a_new_refresh');release();await sending})
 expect(posts).toBe(0);expect(readPending(scope).kind).toBe('empty');expect(result.current.status).toBe('detached')
})

it.each(['access','refresh','clear'])('persist後のcredential変更はPOST0で元pending維持、accessのみならdraftを保持: %s',async(change)=>{
 let posts=0;server.use(http.post('/api/shopping-list-items/purchases',()=>{posts++;return HttpResponse.json({})}))
 const options=callbacks(),{result}=renderHook(()=>useShoppingPurchases(options));await waitFor(()=>expect(result.current.status).toBe('ready'))
 const original=Storage.prototype.setItem
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){original.call(this,key,value);if(key.startsWith('homelog.shoppingPending.')){if(change==='clear')clearTokens();else original.call(this,change==='access'?'homelog.accessToken':'homelog.refreshToken','testuser_changed')}})
 await act(async()=>{await result.current.confirm(lines)})
 expect(posts).toBe(0);expect(readPending(scope).kind).toBe('pending');expect(result.current.status).toBe(change==='access'?'blocked':'detached')
 if(change==='access')expect(options.onDetached).not.toHaveBeenCalled();else expect(options.onDetached).toHaveBeenCalledOnce()
})
it.each([200,409])('旧要求の後着応答が別tabの新pendingを削除しない: %s',async(status)=>{
 let release!:()=>void,received!:()=>void;const gate=new Promise<void>(r=>{release=r}),arrived=new Promise<void>(r=>{received=r})
 server.use(http.post('/api/shopping-list-items/purchases',async({request})=>{const body=await request.json() as {requestId:string};received();await gate;return HttpResponse.json(status===200?response(body.requestId):{code:'RESOURCE_CONFLICT',details:[{field:'purchase',reason:'PURCHASE_NOT_APPLIED'}]},{status})}))
 const options=callbacks(),{result}=renderHook(()=>useShoppingPurchases(options));await waitFor(()=>expect(result.current.status).toBe('ready'))
 let sending!:Promise<void>;act(()=>{sending=result.current.confirm(lines)});await act(async()=>{await arrived})
 localStorage.removeItem(pendingKey(scope));await savePending(scope,{requestId:'22345678-1234-4234-8234-123456789abc',items:[{...lines[0],expectedPurchaseRevision:4}]},()=>true)
 await act(async()=>{release();await sending})
 const current=readPending(scope);expect(current.kind==='pending'&&current.pending.requestId==='22345678-1234-4234-8234-123456789abc').toBe(true);expect(options.onSuccess).not.toHaveBeenCalled();expect(options.onNotApplied).not.toHaveBeenCalled()
})

it('旧操作のcatch/finallyが明示再確認後の同本人セッションを切離さない',async()=>{
 let received!:()=>void,release!:()=>void;const arrived=new Promise<void>(r=>{received=r}),gate=new Promise<void>(r=>{release=r})
 server.use(http.post('/api/shopping-list-items/purchases',async({request})=>{const body=await request.json() as {requestId:string};received();await gate;return HttpResponse.json(response(body.requestId))}))
 const options=callbacks(),{result}=renderHook(()=>useShoppingPurchases(options));await waitFor(()=>expect(result.current.status).toBe('ready'))
 let sending!:Promise<void>;act(()=>{sending=result.current.confirm(lines)});await act(async()=>{await arrived})
 await act(async()=>{setTokens('testuser_a_relogin_access','testuser_a_relogin_refresh');window.dispatchEvent(new StorageEvent('storage',{key:'homelog.accessToken'}))})
 await act(async()=>{await result.current.recheck();release();await sending})
 expect(result.current.status).toBe('unknown');expect(options.onDetached).toHaveBeenCalledTimes(1);expect(readPending(scope).kind).toBe('pending')
})

it('同じpageでactor propsが変わったら旧draft用callbackと表示を破棄し別scopeを読まない',async()=>{
 await savePending(scope,{requestId:'12345678-1234-4234-8234-123456789abc',items:lines},()=>true)
 const options=callbacks(),{result,rerender}=renderHook(({actor})=>useShoppingPurchases({...options,actorUserId:actor}),{initialProps:{actor:1}})
 await waitFor(()=>expect(result.current.status).toBe('unknown'))
 server.use(http.get('/api/auth/me',()=>HttpResponse.json({id:2})))
 await act(async()=>{setTokens('testuser_b_access','testuser_b_refresh');rerender({actor:2})})
 await waitFor(()=>expect(result.current.status).toBe('ready'))
 expect(result.current.pending).toBeNull();expect(options.onDetached).toHaveBeenCalledOnce();expect(readPending(scope).kind).toBe('pending')
})

it('確認内容をawait前にsnapshot化し呼出側の後の数量変更を送らない',async()=>{
 let block=false,entered!:()=>void,release!:()=>void;const arrived=new Promise<void>(r=>{entered=r}),gate=new Promise<void>(r=>{release=r}),bodies:unknown[]=[]
 server.use(http.get('/api/auth/me',async()=>{if(block){entered();await gate}return HttpResponse.json({id:1})}),http.post('/api/shopping-list-items/purchases',async({request})=>{const body=await request.json() as {requestId:string};bodies.push(body);return HttpResponse.json(response(body.requestId))}))
 const {result}=renderHook(()=>useShoppingPurchases(callbacks()));await waitFor(()=>expect(result.current.status).toBe('ready'));block=true
 const changed=structuredClone(lines);let sending!:Promise<void>;act(()=>{sending=result.current.confirm(changed)});await act(async()=>{await arrived});changed[0].purchasedQuantity=9
 await act(async()=>{release();await sending})
 expect((bodies[0] as {items:unknown[]}).items).toEqual(lines)
})

it('terminal拒否後のGET失敗は再取得完了まで新しい確定を停止する',async()=>{
 server.use(http.post('/api/shopping-list-items/purchases',()=>HttpResponse.json({code:'RESOURCE_CONFLICT',details:[{field:'purchase',reason:'PURCHASE_NOT_APPLIED'}]},{status:409})))
 const options=callbacks();options.onNotApplied.mockRejectedValue(new Error('GET'))
 const {result}=renderHook(()=>useShoppingPurchases(options));await waitFor(()=>expect(result.current.status).toBe('ready'));await act(async()=>{await result.current.confirm(lines)})
 expect(result.current.status).toBe('notAppliedRefreshFailed');expect(readPending(scope).kind).toBe('empty')
})

it('actor切替の初回確認待ちを明示再確認で置換しても旧draftを破棄する',async()=>{
 await savePending(scope,{requestId:'12345678-1234-4234-8234-123456789abc',items:lines},()=>true)
 const options=callbacks(),{result,rerender}=renderHook(({actor})=>useShoppingPurchases({...options,actorUserId:actor}),{initialProps:{actor:1}})
 await waitFor(()=>expect(result.current.status).toBe('unknown'))
 let first=true,entered!:()=>void,release!:()=>void;const arrived=new Promise<void>(r=>{entered=r}),gate=new Promise<void>(r=>{release=r})
 server.use(http.get('/api/auth/me',async()=>{if(first){first=false;entered();await gate}return HttpResponse.json({id:2})}))
 await act(async()=>{setTokens('testuser_b_access','testuser_b_refresh');rerender({actor:2})})
 await act(async()=>{await arrived})
 expect(result.current.pending).toBeNull();expect(result.current.status).toBe('detached')
 await act(async()=>{await result.current.recheck();release()})
 expect(result.current.status).toBe('ready');expect(options.onDetached).toHaveBeenCalledOnce();expect(readPending(scope).kind).toBe('pending')
})

it.each([false, true])('idleの同scope再確認はdraft破棄callbackを呼ばない: access更新=%s', async (rotateAccess) => {
 const options = callbacks(), { result } = renderHook(() => useShoppingPurchases(options))
 await waitFor(() => expect(result.current.status).toBe('ready'))
 if (rotateAccess) setTokens('testuser_a_rotated_access', 'testuser_a_refresh')
 await act(async () => { await result.current.recheck() })
 expect(result.current.status).toBe('ready'); expect(result.current.scope).toEqual(scope)
 expect(options.onDetached).not.toHaveBeenCalled(); expect(options.onSuccess).not.toHaveBeenCalled(); expect(options.onNotApplied).not.toHaveBeenCalled()
})

it.each([
 { status: 200, newerPending: false }, { status: 409, newerPending: false },
 { status: 200, newerPending: true }, { status: 409, newerPending: true },
])('同じ元keyを回復する2画面は各自の一覧を同期し別keyには干渉しない: $status / 新pending=$newerPending', async ({ status, newerPending }) => {
 const original = { requestId: '12345678-1234-4234-8234-123456789abc', items: lines }
 expect((await savePending(scope, original, () => true)).kind).toBe('saved')
 const arrived = [deferred(), deferred()], replies = [deferred(), deferred()], refresh = deferred(), refreshEntered = deferred()
 const bodies: unknown[] = []
 server.use(http.post('/api/shopping-list-items/purchases', async ({ request }) => {
  const body = await request.json() as { requestId: string }; const index = bodies.length; bodies.push(body)
  arrived[index].resolve(); await replies[index].promise
  return HttpResponse.json(status === 200 ? response(body.requestId) : { code: 'RESOURCE_CONFLICT', details: [{ field: 'purchase', reason: 'PURCHASE_NOT_APPLIED' }] }, { status })
 }))
 const winnerOptions = callbacks(), loserOptions = callbacks()
 const synchronize = async () => { refreshEntered.resolve(); await refresh.promise }
 if (status === 200) loserOptions.onSuccess.mockImplementation(synchronize)
 else loserOptions.onNotApplied.mockImplementation(synchronize)
 const winner = renderHook(() => useShoppingPurchases(winnerOptions)), loser = renderHook(() => useShoppingPurchases(loserOptions))
 await waitFor(() => { expect(winner.result.current.status).toBe('unknown'); expect(loser.result.current.status).toBe('unknown') })
 let winning!: Promise<void>, losing!: Promise<void>
 act(() => { winning = winner.result.current.recover() })
 await act(async () => { await arrived[0].promise })
 act(() => { losing = loser.result.current.recover() })
 await act(async () => { await arrived[1].promise })
 expect(bodies).toEqual([original, original])
 await act(async () => { replies[0].resolve(); await winning })
 expect(readPending(scope).kind).toBe('empty')
 expect(status === 200 ? winnerOptions.onSuccess : winnerOptions.onNotApplied).toHaveBeenCalledOnce()
 const replacement = { requestId: '22345678-1234-4234-8234-123456789abc', items: [{ ...lines[0], expectedPurchaseRevision: 4 }] }
 if (newerPending) expect((await savePending(scope, replacement, () => true)).kind).toBe('saved')
 try {
  if (newerPending) {
   await act(async () => { replies[1].resolve(); await losing })
   expect(loserOptions.onSuccess).not.toHaveBeenCalled(); expect(loserOptions.onNotApplied).not.toHaveBeenCalled()
   expect(loser.result.current.status).toBe('unknown'); expect(loser.result.current.pending).toMatchObject(replacement)
   const stored = readPending(scope); expect(stored.kind === 'pending' && stored.pending.requestId).toBe(replacement.requestId)
  } else {
   act(() => { replies[1].resolve() })
   await waitFor(() => expect(status === 200 ? loserOptions.onSuccess : loserOptions.onNotApplied).toHaveBeenCalledOnce())
   await act(async () => { await refreshEntered.promise })
   expect(loser.result.current.status).toBe('refreshing')
   if (status === 200) expect(loserOptions.onSuccess).toHaveBeenCalledWith(expect.objectContaining(original), response(original.requestId))
   await act(async () => { refresh.resolve(); await losing })
   expect(loser.result.current.status).toBe(status === 200 ? 'ready' : 'notApplied')
   expect(loser.result.current.pending).toBeNull(); expect(readPending(scope).kind).toBe('empty')
  }
 } finally { replies[1].resolve(); refresh.resolve(); await act(async () => { await losing }) }
})

it.each(['newKey', 'corrupt', 'blocked'] as const)('一致pending削除のlock待機中に変わった保存内容はterminal同期で消費しない: %s', async (change) => {
 const options = callbacks(), entered = deferred(), release = deferred()
 let locks = 0
 Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, callback: () => unknown) => {
  if (++locks === 2) { entered.resolve(); await release.promise }
  return callback()
 } } })
 server.use(http.post('/api/shopping-list-items/purchases', async ({ request }) => {
  const body = await request.json() as { requestId: string }; return HttpResponse.json(response(body.requestId))
 }))
 const { result } = renderHook(() => useShoppingPurchases(options))
 await waitFor(() => expect(result.current.status).toBe('ready'))
 let sending!: Promise<void>
 act(() => { sending = result.current.confirm(lines) })
 await act(async () => { await entered.promise })
 const replacement = { requestId: '22345678-1234-4234-8234-123456789abc', items: [{ ...lines[0], expectedPurchaseRevision: 4 }] }
 let restoreStorage = () => {}
 try {
  if (change === 'newKey') {
   localStorage.removeItem(pendingKey(scope))
   expect((await savePending(scope, replacement, () => true)).kind).toBe('saved')
  } else if (change === 'corrupt') localStorage.setItem(pendingKey(scope), '{invalid [E2E_TEST]')
  else {
   const read = Storage.prototype.getItem
   const unreadable = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
    if (key === pendingKey(scope)) throw new Error('storage unavailable')
    return read.call(this, key)
   })
   restoreStorage = () => { unreadable.mockRestore() }
  }
  await act(async () => { release.resolve(); await sending })
  expect(options.onSuccess).not.toHaveBeenCalled(); expect(options.onNotApplied).not.toHaveBeenCalled()
  expect(result.current.status).toBe(change === 'newKey' ? 'unknown' : change)
  if (change === 'newKey') expect(result.current.pending).toMatchObject(replacement)
  if (change === 'corrupt') expect(localStorage.getItem(pendingKey(scope))).toBe('{invalid [E2E_TEST]')
 } finally { release.resolve(); restoreStorage(); await act(async () => { await sending }) }
})

import { openAccountMenu } from './support/flows'
import type { Page } from '@playwright/test'
import { expect, test } from './console-guard'
import { confirmShoppingPurchase, login, setupUserWithHousehold } from './support/flows'
import { newUser } from './support/test-data'

test.use({ viewport: { width: 390, height: 844 }, trace: 'off' })
type Purchase = { requestId: string; items: { id: number; purchasedQuantity: number; expectedPurchaseRevision: number }[] }
const purchaseUrl = '**/api/shopping-list-items/purchases'
const recoveryButton = (page: Page) => page.getByRole('button', { name: '前回の購入結果を確認', exact: true })
const panel = (page: Page) => page.getByTestId('shopping-panel')
const reflect = (page: Page) => panel(page).getByRole('button', { name: '購入を反映', exact: true })
async function headersFor(page: Page) { return { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('homelog.accessToken')) } }
async function fixture(page: Page, label: string) {
  const user = await setupUserWithHousehold(page, label)
  const headers = await headersFor(page)
  const me = await page.request.get('/api/auth/me', { headers })
  const household = await page.request.get('/api/households/me', { headers })
  expect(me.status()).toBe(200)
  expect(household.status()).toBe(200)
  const actorUserId = (await me.json()).id as number
  const householdId = (await household.json()).id as number
  const categories = await (await page.request.get('/api/zaiko-categories', { headers })).json()
  const name = '[E2E_TEST] ' + label
  const created = await page.request.post('/api/inventory-items', { headers, data: { name, categoryId: categories[0].id, storeId: null, quantity: 5, threshold: 0, price: 123 } })
  expect(created.status()).toBe(201)
  const inventoryId = (await created.json()).id as number
  const added = await page.request.post('/api/shopping-list-items', { headers, data: { inventoryItemId: inventoryId } })
  expect(added.status()).toBe(201)
  const entryId = (await added.json()).id as number
  await page.goto('/zaiko/shopping')
  await expect(panel(page).getByRole('button', { name: name + 'の詳細', exact: true })).toBeVisible()
  return { user, headers, name, inventoryId, entryId, actorUserId, householdId, key: 'homelog.shoppingPending.v1:' + actorUserId + ':' + householdId }
}
async function choose(page: Page, name: string, quantity = '1') {
  await panel(page).getByRole('checkbox', { name: name + 'を購入済みにする', exact: true }).check()
  {
    await panel(page).getByRole('button', { name: name + 'の詳細', exact: true }).click()
    const detail = page.getByRole('dialog', { name: '買い物詳細', exact: true })
    await detail.getByLabel(name + 'の実購入数', { exact: true }).fill(quantity)
    await detail.getByRole('button', { name: '閉じる', exact: true }).click()
  }
  await expect(reflect(page)).toBeEnabled()
}
async function stock(page: Page, inventoryId: number) {
  const response = await page.request.get('/api/inventory-items', { headers: await headersFor(page) })
  expect(response.status()).toBe(200)
  return (await response.json() as { id: number; quantity: number }[]).find(row => row.id === inventoryId)!.quantity
}
async function stored(page: Page, key: string) { return page.evaluate(key => { const raw = localStorage.getItem(key); return raw === null ? null : JSON.parse(raw) }, key) }
function barrier() {
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  return { wait, release }
}

test('実commit後503のpendingはreloadと再loginで残り、明示回復だけで一度反映する (#421)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  const a = await fixture(page, 'purchase_lost')
  const sent: Purchase[] = []
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/shopping-list-items/purchases')) sent.push(request.postDataJSON()) })
  consoleGuard.allow({ url: /\/api\/shopping-list-items\/purchases$/, message: 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)' })
  await page.route(purchaseUrl, async route => {
    const actual = await route.fetch()
    expect(actual.status()).toBe(200)
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'EXTERNAL_SERVICE_ERROR', message: '[E2E_TEST] 保存後に応答喪失', details: [] }) })
  })
  await choose(page, a.name)
  await confirmShoppingPurchase(page)
  await expect(recoveryButton(page)).toBeEnabled()
  expect(sent).toHaveLength(1)
  expect(await stock(page, a.inventoryId)).toBe(6)
  const pending = await stored(page, a.key)
  expect(Object.keys(pending).sort()).toEqual(['actorUserId', 'createdAt', 'householdId', 'items', 'requestId', 'version'])
  expect(pending.items).toEqual(sent[0].items)
  expect(pending.requestId).toBe(sent[0].requestId)
  await page.unroute(purchaseUrl)
  await page.reload()
  await expect(recoveryButton(page)).toBeEnabled()
  await expect(panel(page).getByRole('button', { name: a.name + 'の詳細', exact: true })).toHaveCount(0)
  expect(sent).toHaveLength(1)
  await (await openAccountMenu(page)).getByRole('button', { name: 'ログアウト', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await login(page, a.user)
  await expect(page).toHaveURL(/\/zaiko\/shopping$/)
  await page.goto('/zaiko/shopping')
  await expect(recoveryButton(page)).toBeEnabled()
  expect(sent).toHaveLength(1)
  await recoveryButton(page).click()
  await expect(recoveryButton(page)).toHaveCount(0)
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual(sent[0])
  expect(await stored(page, a.key)).toBeNull()
  expect(await stock(page, a.inventoryId)).toBe(6)
})

test('購入200後のGET失敗は反映済みとしてGETだけ再試行し、再POSTしない (#421)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  const a = await fixture(page, 'purchase_get_failed')
  let purchased = false
  let posts = 0
  consoleGuard.allow({ url: /\/api\/inventory-items$/, message: 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)' })
  await page.route(purchaseUrl, async route => {
    posts++
    const actual = await route.fetch()
    expect(actual.status()).toBe(200)
    purchased = true
    await route.fulfill({ response: actual })
  })
  await page.route('**/api/inventory-items', async route => {
    if (purchased && route.request().method() === 'GET') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'EXTERNAL_SERVICE_ERROR', message: '[E2E_TEST] 一覧取得不可', details: [] }) })
    else await route.continue()
  })
  await choose(page, a.name)
  await confirmShoppingPurchase(page)
  await expect(page.getByRole('status').filter({ hasText: '購入は反映済み' })).toBeVisible()
  expect(posts).toBe(1)
  expect(await stored(page, a.key)).toBeNull()
  await expect(recoveryButton(page)).toHaveCount(0)
  await page.unroute('**/api/inventory-items')
  await page.getByRole('button', { name: '一覧を再取得', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: a.name + 'の詳細', exact: true })).toHaveCount(0)
  expect(posts).toBe(1)
  expect(await stock(page, a.inventoryId)).toBe(6)
})

test('実MISMATCHは元pendingを保持し、変更後bodyや新keyで購入しない (#421)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  const a = await fixture(page, 'purchase_mismatch')
  let original: Purchase | undefined
  const sent: Purchase[] = []
  consoleGuard.allow({ url: /\/api\/shopping-list-items\/purchases$/, message: 'Failed to load resource: the server responded with a status of 409 (Conflict)' })
  await page.route(purchaseUrl, async route => {
    const requested = route.request().postDataJSON() as Purchase
    sent.push(requested)
    if (!original) {
      original = requested
      const other = await page.request.post('/api/shopping-list-items/purchases', { headers: a.headers, data: { ...requested, items: requested.items.map(line => ({ ...line, purchasedQuantity: 2 })) } })
      expect(other.status()).toBe(200)
    }
    const mismatch = await route.fetch()
    expect(mismatch.status()).toBe(409)
    expect(await mismatch.json()).toMatchObject({ code: 'SHOPPING_PURCHASE_REQUEST_MISMATCH' })
    await route.fulfill({ response: mismatch })
  })
  await choose(page, a.name)
  await confirmShoppingPurchase(page)
  await expect(recoveryButton(page)).toBeEnabled()
  const pending = await stored(page, a.key)
  expect(pending.requestId).toBe(original!.requestId)
  expect(pending.items).toEqual(original!.items)
  await expect(reflect(page)).toBeDisabled()
  await recoveryButton(page).click()
  await expect(recoveryButton(page)).toBeEnabled()
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual(sent[0])
  expect(await stored(page, a.key)).toEqual(pending)
  expect(await stock(page, a.inventoryId)).toBe(7)
})

for (const mode of ['set', 'get', 'readback', 'locks-unavailable', 'locks-reject'] as const) {
  test('保存・短期排他が利用できないと購入POST0: ' + mode + ' (#421)', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    const a = await fixture(page, 'purchase_capability_' + mode)
    let posts = 0
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/shopping-list-items/purchases')) posts++ })
    await page.addInitScript(mode => {
      const originalGet = Storage.prototype.getItem
      const originalSet = Storage.prototype.setItem
      if (mode === 'get') Storage.prototype.getItem = function (key) { if (key.startsWith('homelog.shoppingPending.v1:')) throw new DOMException('E2E read denied', 'SecurityError'); return originalGet.call(this, key) }
      if (mode === 'set') Storage.prototype.setItem = function (key, value) { if (key.startsWith('homelog.shoppingPending.v1:')) throw new DOMException('E2E quota', 'QuotaExceededError'); originalSet.call(this, key, value) }
      if (mode === 'readback') Storage.prototype.setItem = function (key, value) { originalSet.call(this, key, key.startsWith('homelog.shoppingPending.v1:') ? value.replace(/"requestId":"[^"]+"/, '"requestId":"invalid"') : value) }
      if (mode === 'locks-unavailable') Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
      if (mode === 'locks-reject') Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: () => Promise.reject(new DOMException('E2E lock denied', 'NotAllowedError')) } })
    }, mode)
    await page.reload()
    const checkbox = panel(page).getByRole('checkbox', { name: a.name + 'を購入済みにする', exact: true })
    await expect(checkbox).toBeVisible()
    if (mode === 'get' || mode === 'locks-unavailable') {
      await expect(page.getByRole('status').filter({ hasText: /確認できません|安全な保存/ })).toBeVisible()
      await expect(reflect(page)).toBeDisabled()
    } else {
      await choose(page, a.name)
      await confirmShoppingPurchase(page)
      await expect(page.getByRole('status').filter({ hasText: /送信していません|確認できません|再確認/ })).toBeVisible()
    }
    expect(posts).toBe(0)
    expect(await stock(page, a.inventoryId)).toBe(5)
  })
}


test('native短期Web Locksで2tab同時確認は同keyだけを保存し、通信中にlockを保持しない (#421)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  const a = await fixture(page, 'purchase_parallel_tabs')
  const planned = await page.request.patch('/api/shopping-list-items/' + a.entryId, { headers: a.headers, data: { plannedQuantity: 3, expectedPurchaseRevision: 0 } })
  expect(planned.status()).toBe(200)
  await page.addInitScript(() => window.addEventListener('storage', event => { if (event.key?.startsWith('homelog.shoppingPending.v1:')) event.stopImmediatePropagation() }, true))
  await page.reload()
  const second = await page.context().newPage()
  consoleGuard.watch(second)
  await second.addInitScript(() => window.addEventListener('storage', event => { if (event.key?.startsWith('homelog.shoppingPending.v1:')) event.stopImmediatePropagation() }, true))
  const gates = [barrier(), barrier()]
  const sent: Purchase[] = []
  const inFlight: Promise<void>[] = []
  const context = page.context()
  await context.route(purchaseUrl, async route => {
    const task = (async () => {
      const index = sent.length
      sent.push(route.request().postDataJSON())
      await gates[index].wait
      const actual = await route.fetch()
      expect(actual.status()).toBe(200)
      await route.fulfill({ response: actual })
    })().catch(() => { throw new Error('[E2E_TEST] 購入応答の配送に失敗しました') })
    inFlight.push(task)
    await task
  })
  try {
    await second.goto('/zaiko/shopping')
    await choose(page, a.name, '1')
    await choose(second, a.name, '1')
    for (const tab of [page, second]) await reflect(tab).click()
    await Promise.all([page, second].map(tab => tab.getByRole('dialog', { name: '購入内容の確認', exact: true }).getByRole('button', { name: 'この内容で購入を反映', exact: true }).click()))
    await expect.poll(() => sent.length).toBeGreaterThan(0)
    const pending = await stored(page, a.key)
    expect(pending.items).toEqual([{ id: a.entryId, purchasedQuantity: 1, expectedPurchaseRevision: 1 }])
    expect(new Set(sent.map(value => value.requestId)).size).toBe(1)
    expect(sent.every(value => value.requestId === pending.requestId && JSON.stringify(value.items) === JSON.stringify(pending.items))).toBe(true)
    const held = await page.evaluate(async () => (await navigator.locks.query()).held?.filter(lock => lock.name?.startsWith('homelog.shoppingPending.v1:')).length ?? 0)
    expect(held).toBe(0)
    // Hold both deliveries: the second tab explicitly recovers the same saved key.
    await expect.poll(async () => await recoveryButton(page).isEnabled() || await recoveryButton(second).isEnabled()).toBe(true)
    const waiting = await recoveryButton(page).isEnabled() ? page : second
    await expect(recoveryButton(waiting)).toBeEnabled()
    await recoveryButton(waiting).click()
    await expect.poll(() => sent.length).toBe(2)
    expect(sent[1]).toEqual(sent[0])
    gates[0].release()
    await expect.poll(() => stock(page, a.inventoryId)).toBe(6)
    await expect.poll(() => stored(page, a.key)).toBeNull()
    gates[1].release()
    for (const tab of [page, second]) {
      const row = panel(tab).getByRole('button', { name: a.name + 'の詳細', exact: true })
      await expect(row).toContainText('予定 2')
      await expect(panel(tab).getByRole('checkbox', { name: a.name + 'を購入済みにする', exact: true })).not.toBeChecked()
      await expect(recoveryButton(tab)).toHaveCount(0)
    }
    expect(new Set(sent.map(value => value.requestId)).size).toBe(1)
    expect(await stock(page, a.inventoryId)).toBe(6)
  } finally {
    gates.forEach(gate => gate.release())
    await Promise.allSettled(inFlight)
    await context.unroute(purchaseUrl)
    await second.close()
  }
})

for (const lateStatus of [401, 200]) {
  test('別tabでBへ切替後の旧A応答' + lateStatus + 'はrefresh・再POST・Bへの反映をしない (#421)', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    const a = await fixture(page, 'purchase_session_' + lateStatus)
    // 配送済みstorageイベントに頼らず、実storage同期読取と固定Bearerを検証する。
    await page.addInitScript(() => window.addEventListener('storage', event => event.stopImmediatePropagation(), true))
    await page.reload()
    const userB = newUser('purchase_session_b_' + lateStatus)
    expect((await page.request.post('/api/auth/register', { data: userB })).status()).toBe(201)
    const loggedB = await page.request.post('/api/auth/login', { data: { email: userB.email, password: userB.password } })
    expect(loggedB.status()).toBe(200)
    const seedHeadersB = { Authorization: 'Bearer ' + (await loggedB.json()).accessToken }
    expect((await page.request.post('/api/households', { headers: seedHeadersB, data: { name: '[E2E_TEST] B household' } })).status()).toBe(201)
    const bCategories = await (await page.request.get('/api/zaiko-categories', { headers: seedHeadersB })).json()
    const bName = '[E2E_TEST] 別userの品目'
    const bItem = await page.request.post('/api/inventory-items', { headers: seedHeadersB, data: { name: bName, categoryId: bCategories[0].id, storeId: null, quantity: 5, threshold: 0, price: 123 } })
    expect(bItem.status()).toBe(201)
    const bItemId = (await bItem.json()).id as number
    expect((await page.request.post('/api/shopping-list-items', { headers: seedHeadersB, data: { inventoryItemId: bItemId } })).status()).toBe(201)
    const tabB = await page.context().newPage()
    consoleGuard.watch(tabB)
    const gate = barrier()
    let original: Purchase | undefined
    let purchasePostsA = 0
    let refreshPostsA = 0
    let logoutPostsA = 0
    let oldBodyUsedB = false
    let firstUsedA = false
    let committed = false
    let currentBHeader = ''
    page.on('request', request => {
      if (request.method() !== 'POST') return
      if (request.url().endsWith('/auth/refresh')) refreshPostsA++
      if (request.url().endsWith('/auth/logout')) logoutPostsA++
      if (request.url().endsWith('/shopping-list-items/purchases')) {
        purchasePostsA++
        if (currentBHeader && request.headers().authorization === currentBHeader) oldBodyUsedB = true
      }
    })
    if (lateStatus === 401) consoleGuard.allow({ url: /\/api\/shopping-list-items\/purchases$/, message: 'Failed to load resource: the server responded with a status of 401 (Unauthorized)' })
    await page.route(purchaseUrl, async route => {
      original = route.request().postDataJSON()
      firstUsedA = route.request().headers().authorization === a.headers.Authorization
      const actual = lateStatus === 200 ? await route.fetch() : null
      if (actual) { expect(actual.status()).toBe(200); committed = true }
      await gate.wait
      if (actual) await route.fulfill({ response: actual })
      else await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'UNAUTHORIZED', message: '[E2E_TEST] 古い購入認証', details: [] }) })
    })
    try {
      await choose(page, a.name)
      await confirmShoppingPurchase(page)
      await expect.poll(() => !!original && (lateStatus === 401 || committed)).toBe(true)
      const pendingA = await stored(page, a.key)
      await tabB.goto('/')
      await (await openAccountMenu(tabB)).getByRole('button', { name: 'ログアウト', exact: true }).click()
      await expect(tabB).toHaveURL(/\/login$/)
      await login(tabB, userB)
      await expect(tabB).toHaveURL(/\/$/)
      currentBHeader = (await headersFor(tabB)).Authorization
      gate.release()
      await expect(page.getByRole('status').filter({ hasText: 'ログイン状態が変更されました' })).toBeVisible()
      expect(firstUsedA).toBe(true)
      expect(purchasePostsA).toBe(1)
      expect(refreshPostsA).toBe(0)
      expect(logoutPostsA).toBe(0)
      expect(oldBodyUsedB).toBe(false)
      expect((await headersFor(tabB)).Authorization === currentBHeader).toBe(true)
      expect(await stored(tabB, a.key)).toEqual(pendingA)
      await tabB.goto('/zaiko/shopping')
      await expect(panel(tabB).getByRole('button', { name: bName + 'の詳細', exact: true })).toBeVisible()
      await expect(panel(tabB).getByRole('button', { name: a.name + 'の詳細', exact: true })).toHaveCount(0)
      await expect(recoveryButton(tabB)).toHaveCount(0)
      expect(await stock(tabB, bItemId)).toBe(5)
      await expect(tabB.getByRole('status').filter({ hasText: '購入を反映しました' })).toHaveCount(0)
      await page.unroute(purchaseUrl)
      await (await openAccountMenu(tabB)).getByRole('button', { name: 'ログアウト', exact: true }).click()
      await expect(tabB).toHaveURL(/\/login$/)
      await login(tabB, a.user)
      await expect(tabB).toHaveURL(/\/zaiko\/shopping$/)
      const recovered: Purchase[] = []
      tabB.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/shopping-list-items/purchases')) recovered.push(request.postDataJSON()) })
      await tabB.goto('/zaiko/shopping')
      await expect(recoveryButton(tabB)).toBeEnabled()
      expect(recovered).toHaveLength(0)
      await recoveryButton(tabB).click()
      await expect(recoveryButton(tabB)).toHaveCount(0)
      expect(recovered).toEqual([original])
      expect(await stock(tabB, a.inventoryId)).toBe(6)
      expect(await stored(tabB, a.key)).toBeNull()
    } finally {
      gate.release()
      await page.unroute(purchaseUrl)
      await tabB.close()
    }
  })
}


test('別tabで旧terminal409を解決してnewkey待機中、後着旧応答が新pendingとdraftを消さない (#421)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  const a = await fixture(page, 'purchase_late_terminal')
  const second = await page.context().newPage()
  consoleGuard.watch(second)
  consoleGuard.allow({ url: /\/api\/shopping-list-items\/purchases$/, message: 'Failed to load resource: the server responded with a status of 409 (Conflict)' })
  const oldGate = barrier()
  const newGate = barrier()
  let oldBody: Purchase | undefined
  let newBody: Purchase | undefined
  let oldReleased = false
  const observed: Purchase[] = []
  for (const tab of [page, second]) tab.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/shopping-list-items/purchases')) observed.push(request.postDataJSON())
  })
  await page.route(purchaseUrl, async route => {
    oldBody = route.request().postDataJSON()
    await oldGate.wait
    const rejection = await route.fetch()
    expect(rejection.status()).toBe(409)
    expect(await rejection.json()).toMatchObject({ code: 'RESOURCE_CONFLICT', details: [{ field: 'purchase', reason: 'PURCHASE_NOT_APPLIED' }] })
    await route.fulfill({ response: rejection })
    oldReleased = true
  })
  try {
    await choose(page, a.name)
    await confirmShoppingPurchase(page)
    await expect.poll(() => !!oldBody).toBe(true)
    // 元request確定後、別の予定保存を先に確定させて古revisionを拒否する。
    const revised = await page.request.patch('/api/shopping-list-items/' + a.entryId, { headers: a.headers, data: { plannedQuantity: 3, expectedPurchaseRevision: 0 } })
    expect(revised.status()).toBe(200)
    await second.goto('/zaiko/shopping')
    await expect(recoveryButton(second)).toBeEnabled()
    await recoveryButton(second).click()
    await expect(recoveryButton(second)).toHaveCount(0)
    await expect(second.getByRole('status').filter({ hasText: '購入は反映されていません' })).toBeVisible()
    await expect(panel(second).getByRole('button', { name: a.name + 'の詳細', exact: true })).toContainText('予定 3')
    expect(await stored(second, a.key)).toBeNull()
    expect(await stock(second, a.inventoryId)).toBe(5)
    await second.route(purchaseUrl, async route => {
      newBody = route.request().postDataJSON()
      await newGate.wait
      const actual = await route.fetch()
      expect(actual.status()).toBe(200)
      await route.fulfill({ response: actual })
    })
    await choose(second, a.name, '1')
    await confirmShoppingPurchase(second)
    await expect.poll(() => !!newBody).toBe(true)
    expect(newBody!.requestId === oldBody!.requestId).toBe(false)
    expect(newBody!.items).toEqual([{ id: a.entryId, purchasedQuantity: 1, expectedPurchaseRevision: 1 }])
    const pendingNew = await stored(second, a.key)
    expect(pendingNew.requestId).toBe(newBody!.requestId)
    oldGate.release()
    await expect.poll(() => oldReleased).toBe(true)
    await expect(recoveryButton(page)).toBeEnabled()
    expect(await stored(second, a.key)).toEqual(pendingNew)
    await expect(panel(second).getByRole('checkbox', { name: a.name + 'を購入済みにする', exact: true })).toBeChecked()
    await expect(panel(second).getByRole('button', { name: a.name + 'の詳細', exact: true })).toContainText('実購入 1')
    expect(new Set(observed.map(value => value.requestId)).size).toBe(2)
    newGate.release()
    await expect.poll(() => stored(second, a.key)).toBeNull()
    await expect(panel(second).getByRole('checkbox', { name: a.name + 'を購入済みにする', exact: true })).not.toBeChecked()
    expect(await stock(second, a.inventoryId)).toBe(6)
    const lateOld = await page.request.post('/api/shopping-list-items/purchases', { headers: a.headers, data: oldBody })
    expect(lateOld.status()).toBe(409)
    expect(await lateOld.json()).toMatchObject({ details: [{ field: 'purchase', reason: 'PURCHASE_NOT_APPLIED' }] })
    expect(await stock(second, a.inventoryId)).toBe(6)
    expect(new Set(observed.map(value => value.requestId)).size).toBe(2)
  } finally {
    oldGate.release()
    newGate.release()
    await page.unroute(purchaseUrl)
    await second.unroute(purchaseUrl)
    await second.close()
  }
})


test('通常GETと予定保存の401refreshは同sessionを維持し、一覧と保存結果を反映する (#421)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  await setupUserWithHousehold(page, 'shopping_normal_refresh')
  const name = '[E2E_TEST] 通常refreshを維持する品目'
  // 実credentialはbrowser closure内だけで使い、Node/trace/失敗期待値へ返さない。
  const seed = await page.evaluate(async name => {
    const headers = { Authorization: 'Bearer ' + localStorage.getItem('homelog.accessToken'), 'Content-Type': 'application/json' }
    const categories = await fetch('/api/zaiko-categories', { headers })
    const category = (await categories.json())[0]
    const created = await fetch('/api/inventory-items', { method: 'POST', headers, body: JSON.stringify({ name, categoryId: category.id, storeId: null, quantity: 5, threshold: 0, price: 123 }) })
    const inventory = await created.json()
    const added = await fetch('/api/shopping-list-items', { method: 'POST', headers, body: JSON.stringify({ inventoryItemId: inventory.id }) })
    const entry = await added.json()
    return { categoryStatus: categories.status, createStatus: created.status, addStatus: added.status, entryId: entry.id as number }
  }, name)
  expect({ category: seed.categoryStatus, create: seed.createStatus, add: seed.addStatus }).toEqual({ category: 200, create: 201, add: 201 })
  await page.goto('/zaiko/shopping')
  const row = panel(page).getByRole('button', { name: name + 'の詳細', exact: true })
  await expect(row).toContainText('予定 1')
  await expect(panel(page).getByRole('checkbox', { name: name + 'を購入済みにする', exact: true })).toBeEnabled()
  const externalPlanStatus = await page.evaluate(async entryId => {
    const response = await fetch('/api/shopping-list-items/' + entryId, { method: 'PATCH', headers: { Authorization: 'Bearer ' + localStorage.getItem('homelog.accessToken'), 'Content-Type': 'application/json' }, body: JSON.stringify({ plannedQuantity: 3, expectedPurchaseRevision: 0 }) })
    return response.status
  }, seed.entryId)
  expect(externalPlanStatus).toBe(200)
  let refreshes = 0
  let shoppingReads = 0
  let planRequests = 0
  let purchases = 0
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (path === '/api/auth/refresh' && request.method() === 'POST') refreshes++
    if (path === '/api/shopping-list-items' && request.method() === 'GET') shoppingReads++
    if (path === '/api/shopping-list-items/' + seed.entryId && request.method() === 'PATCH') planRequests++
    if (path === '/api/shopping-list-items/purchases' && request.method() === 'POST') purchases++
  })
  consoleGuard.allow({ url: /\/api\/shopping-list-items\?sort=name$/, message: 'Failed to load resource: the server responded with a status of 401 (Unauthorized)' })
  consoleGuard.allow({ url: new RegExp('/api/shopping-list-items/' + seed.entryId + '$'), message: 'Failed to load resource: the server responded with a status of 401 (Unauthorized)' })
  await page.evaluate(() => {
    const marker = localStorage.getItem('homelog.refreshToken')
    Object.defineProperty(window, '__e2eRefreshSessionUnchanged', { configurable: true, get: () => marker !== null && localStorage.getItem('homelog.refreshToken') === marker })
    localStorage.setItem('homelog.accessToken', 'e2e_expired_access_for_normal_get')
  })
  try {
    await panel(page).getByLabel('並び替え').selectOption('name')
    await expect(row).toContainText('予定 3')
    expect(refreshes).toBe(1)
    expect(shoppingReads).toBe(2)
    await choose(page, name, '2')
    await row.click()
    const detail = page.getByRole('dialog', { name: '買い物詳細', exact: true })
    await detail.getByLabel(name + 'の予定数', { exact: true }).fill('4')
    await page.evaluate(() => localStorage.setItem('homelog.accessToken', 'e2e_expired_access_for_normal_patch'))
    await detail.getByRole('button', { name: '予定数を保存', exact: true }).click()
    await expect(detail.getByRole('button', { name: '予定数を保存', exact: true })).toBeEnabled()
    await detail.getByRole('button', { name: '閉じる', exact: true }).click()
    await expect(row).toContainText('予定 4')
    expect(refreshes).toBe(2)
    expect(planRequests).toBe(2)
    expect(purchases).toBe(0)
    await expect(panel(page).getByRole('checkbox', { name: name + 'を購入済みにする', exact: true })).toBeChecked()
    await row.click()
    await expect(detail.getByLabel(name + 'の実購入数', { exact: true })).toHaveValue('2')
    await detail.getByLabel(name + 'の予定数', { exact: true }).fill('5')
    await detail.getByRole('button', { name: '閉じる', exact: true }).click()
    await confirmShoppingPurchase(page)
    await expect(row).toContainText('予定 2')
    await expect(row).toContainText('在庫 7')
    expect(purchases).toBe(1)
    expect(refreshes).toBe(2)
    await row.click()
    await expect(detail.getByLabel(name + 'の予定数', { exact: true })).toHaveValue('5')
    const sessionUnchanged = await page.evaluate(() => (window as Window & { __e2eRefreshSessionUnchanged?: boolean }).__e2eRefreshSessionUnchanged === true)
    expect(sessionUnchanged).toBe(true)
  } finally { await page.evaluate(() => Reflect.deleteProperty(window, '__e2eRefreshSessionUnchanged')) }
})


test('未保存の予定5を残し、保存済予定3から実2だけ購入してサーバ残1と区別する (#421)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  await setupUserWithHousehold(page, 'purchase_dirty_plan')
  const name = '[E2E_TEST] purchase_dirty_plan'
  const seed = await page.evaluate(async name => {
    const headers = { Authorization: 'Bearer ' + localStorage.getItem('homelog.accessToken'), 'Content-Type': 'application/json' }
    const categories = await fetch('/api/zaiko-categories', { headers })
    const category = (await categories.json())[0]
    const created = await fetch('/api/inventory-items', { method: 'POST', headers, body: JSON.stringify({ name, categoryId: category.id, storeId: null, quantity: 5, threshold: 0, price: 123 }) })
    const inventory = await created.json()
    const added = await fetch('/api/shopping-list-items', { method: 'POST', headers, body: JSON.stringify({ inventoryItemId: inventory.id }) })
    const entry = await added.json()
    return { categoryStatus: categories.status, createStatus: created.status, addStatus: added.status, entryId: entry.id as number, inventoryId: inventory.id as number }
  }, name)
  expect({ category: seed.categoryStatus, create: seed.createStatus, add: seed.addStatus }).toEqual({ category: 200, create: 201, add: 201 })
  await page.goto('/zaiko/shopping')
  let planWrites = 0
  const sent: Purchase[] = []
  page.on('request', request => {
    if (request.method() === 'PATCH' && request.url().endsWith('/shopping-list-items/' + seed.entryId)) planWrites++
    if (request.method() === 'POST' && request.url().endsWith('/shopping-list-items/purchases')) sent.push(request.postDataJSON())
  })
  await choose(page, name, '2')
  const row = panel(page).getByRole('button', { name: name + 'の詳細', exact: true })
  const detail = page.getByRole('dialog', { name: '買い物詳細', exact: true })
  const planned = detail.getByLabel(name + 'の予定数', { exact: true })
  await row.click()
  await planned.fill('3')
  const savedResponse = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/shopping-list-items/' + seed.entryId))
  await detail.getByRole('button', { name: '予定数を保存', exact: true }).click()
  expect((await savedResponse).status()).toBe(200)
  await expect(detail.getByRole('button', { name: '予定数を保存', exact: true })).toBeEnabled()
  await expect(detail.getByLabel(name + 'の実購入数', { exact: true })).toHaveValue('2')
  await planned.fill('5')
  await detail.getByRole('button', { name: '閉じる', exact: true }).click()
  await confirmShoppingPurchase(page)
  await expect(row).toContainText('予定 1')
  await row.click()
  await expect(planned).toHaveValue('5')
  expect(planWrites).toBe(1)
  expect(sent).toEqual([{ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), items: [{ id: seed.entryId, purchasedQuantity: 2, expectedPurchaseRevision: 1 }] }])
  const persisted = await page.evaluate(async ({ entryId, inventoryId }) => {
    const headers = { Authorization: 'Bearer ' + localStorage.getItem('homelog.accessToken') }
    const shoppingResponse = await fetch('/api/shopping-list-items', { headers })
    const item = (await shoppingResponse.json() as { id: number; plannedQuantity: number; purchaseRevision: number }[]).find(item => item.id === entryId)
    const inventoryResponse = await fetch('/api/inventory-items', { headers })
    const inventory = (await inventoryResponse.json() as { id: number; quantity: number }[]).find(item => item.id === inventoryId)
    return { shoppingStatus: shoppingResponse.status, inventoryStatus: inventoryResponse.status, plannedQuantity: item?.plannedQuantity, purchaseRevision: item?.purchaseRevision, quantity: inventory?.quantity }
  }, { entryId: seed.entryId, inventoryId: seed.inventoryId })
  expect(persisted).toEqual({ shoppingStatus: 200, inventoryStatus: 200, plannedQuantity: 1, purchaseRevision: 2, quantity: 7 })
  // 明示保存後はclean。別利用者の新予定を取得したら古い5を最新revisionで上書きしない。
  const saveDirty = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/shopping-list-items/' + seed.entryId))
  await detail.getByRole('button', { name: '予定数を保存', exact: true }).click()
  expect((await saveDirty).status()).toBe(200)
  await expect(detail.getByRole('button', { name: '予定数を保存', exact: true })).toBeEnabled()
  await detail.getByRole('button', { name: '閉じる', exact: true }).click()
  const external = await page.evaluate(async entryId => {
    const response = await fetch('/api/shopping-list-items/' + entryId, { method: 'PATCH', headers: { Authorization: 'Bearer ' + localStorage.getItem('homelog.accessToken'), 'Content-Type': 'application/json' }, body: JSON.stringify({ plannedQuantity: 7, expectedPurchaseRevision: 3 }) })
    return response.status
  }, seed.entryId)
  expect(external).toBe(200)
  await panel(page).getByLabel('並び替え').selectOption('name')
  await expect(row).toContainText('予定 7')
  await row.click()
  await expect(planned).toHaveValue('7')
  const saveLatest = page.waitForRequest(request => request.method() === 'PATCH' && request.url().endsWith('/shopping-list-items/' + seed.entryId))
  const savedLatest = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/shopping-list-items/' + seed.entryId))
  await detail.getByRole('button', { name: '予定数を保存', exact: true }).click()
  expect((await saveLatest).postDataJSON()).toEqual({ plannedQuantity: 7, expectedPurchaseRevision: 4 })
  expect((await savedLatest).status()).toBe(200)
  expect(planWrites).toBe(4)
  expect(sent).toHaveLength(1)
})


test('世帯再確認は両一覧の旧行を隔離しGET失敗後も新一覧成功まで購入を再開しない (#421)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  const a = await fixture(page, 'purchase_household_reconnect')
  const inventoryResponse = await page.request.get('/api/inventory-items', { headers: a.headers })
  const shoppingResponse = await page.request.get('/api/shopping-list-items', { headers: a.headers })
  expect(inventoryResponse.status()).toBe(200); expect(shoppingResponse.status()).toBe(200)
  const oldInventory = (await inventoryResponse.json()).find((row: { id: number }) => row.id === a.inventoryId)
  const oldShopping = (await shoppingResponse.json()).find((row: { id: number }) => row.id === a.entryId)
  const freshName = '[E2E_TEST] 再確認後の新世帯品目'
  const freshInventory = { ...oldInventory, id: a.inventoryId + 100000, name: freshName, quantity: 9 }
  const freshShopping = { ...oldShopping, id: a.entryId + 100000, inventoryItemId: freshInventory.id, name: freshName, plannedQuantity: 4, purchaseRevision: 0 }
  // Identity and list GET fixtures isolate a household transition; purchase POST stays real and must remain zero.
  const getGate = barrier()
  let reconnect = false, fresh = false, gets = 0, posts = 0
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/shopping-list-items/purchases')) posts++ })
  await page.route('**/api/households/me', async route => {
    if (!reconnect) { await route.continue(); return }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: a.householdId + 100000 }) })
  })
  for (const resource of ['inventory-items', 'shopping-list-items']) {
    consoleGuard.allow({ url: new RegExp('/api/' + resource + '(?:\\?.*)?$'), message: 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)' })
    await page.route('**/api/' + resource + '*', async route => {
      if (!reconnect || route.request().method() !== 'GET') { await route.continue(); return }
      gets++
      if (!fresh) {
        await getGate.wait
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '[E2E_TEST] reconnect list unavailable' }) })
      } else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([resource === 'inventory-items' ? freshInventory : freshShopping]) })
    })
  }
  try {
    await choose(page, a.name, '0.5')
    reconnect = true
    await confirmShoppingPurchase(page)
    const recheck = page.getByRole('button', { name: '本人と世帯を再確認', exact: true })
    await expect(recheck).toBeEnabled()
    await recheck.click()
    await expect.poll(() => gets).toBeGreaterThanOrEqual(2)
    await expect(page.getByRole('button', { name: a.name + 'の詳細', exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: '在庫一覧', exact: true }).click()
    await expect(page.getByRole('button', { name: a.name + 'の詳細', exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: '買い物リスト', exact: true }).click()
    getGate.release()
    const retry = page.getByRole('button', { name: '一覧を再取得', exact: true })
    await expect(retry).toBeEnabled()
    await expect(page.getByRole('button', { name: a.name + 'の詳細', exact: true })).toHaveCount(0)
    await expect(reflect(page)).toHaveCount(0)
    await expect(panel(page).getByRole('button', { name: '品目を追加', exact: true })).toBeDisabled()
    fresh = true
    await retry.click()
    const row = panel(page).getByRole('button', { name: freshName + 'の詳細', exact: true })
    await expect(row).toContainText('予定 4')
    await expect(panel(page).getByRole('checkbox', { name: freshName + 'を購入済みにする', exact: true })).not.toBeChecked()
    await page.getByRole('link', { name: '在庫一覧', exact: true }).click()
    await expect(page.getByRole('button', { name: freshName + 'の詳細', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: a.name + 'の詳細', exact: true })).toHaveCount(0)
    expect(posts).toBe(0)
  } finally {
    getGate.release()
    await page.unroute('**/api/households/me')
    for (const resource of ['inventory-items', 'shopping-list-items']) await page.unroute('**/api/' + resource + '*')
  }
})


test('unknown待機中に別tabが同要求を解決するとnative storage通知でGET同期し失敗時も再POSTしない (#421)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  const a = await fixture(page, 'purchase_native_storage_resolution')
  const sent: Purchase[] = []
  for (const tab of [page]) tab.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/shopping-list-items/purchases')) sent.push(request.postDataJSON()) })
  consoleGuard.allow({ url: /\/api\/shopping-list-items\/purchases$/, message: 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)' })
  await page.route(purchaseUrl, async route => {
    const actual = await route.fetch().catch(() => { throw new Error('[E2E_TEST] 購入応答の取得に失敗しました') })
    expect(actual.status()).toBe(200)
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '[E2E_TEST] commit後の応答喪失' }) })
  })
  await choose(page, a.name)
  await confirmShoppingPurchase(page)
  await expect(recoveryButton(page)).toBeEnabled()
  expect(sent).toHaveLength(1)
  const original = await stored(page, a.key)
  expect(original.requestId).toBe(sent[0].requestId)
  await page.unroute(purchaseUrl)
  const second = await page.context().newPage()
  consoleGuard.watch(second)
  second.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/shopping-list-items/purchases')) sent.push(request.postDataJSON()) })
  const gate = barrier()
  let synchronizing = false, reads = 0
  consoleGuard.allow({ url: /\/api\/inventory-items$/, message: 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)' })
  await page.route('**/api/inventory-items', async route => {
    if (!synchronizing || route.request().method() !== 'GET') { await route.continue(); return }
    reads++
    await gate.wait
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '[E2E_TEST] 他画面解決後GET失敗' }) })
  })
  try {
    // Native storage events are intentionally NOT suppressed for this entry.
    await second.goto('/zaiko/shopping')
    await expect(recoveryButton(second)).toBeEnabled()
    synchronizing = true
    await recoveryButton(second).click()
    await expect(recoveryButton(second)).toHaveCount(0)
    await expect.poll(() => stored(second, a.key)).toBeNull()
    await expect.poll(() => reads).toBe(1)
    await expect(reflect(page)).toBeDisabled()
    expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0])
    gate.release()
    const retry = page.getByRole('button', { name: '一覧を再取得', exact: true })
    await expect(retry).toBeEnabled()
    await expect(reflect(page)).toBeDisabled()
    expect(sent).toHaveLength(2)
    await page.unroute('**/api/inventory-items')
    await retry.click()
    await expect(retry).toHaveCount(0)
    await expect(panel(page).getByRole('button', { name: a.name + 'の詳細', exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: '在庫一覧', exact: true }).click()
    await expect(page.getByText('6.0', { exact: true })).toBeVisible()
    expect(sent).toHaveLength(2)
    expect(new Set(sent.map(body => body.requestId)).size).toBe(1)
    expect(await stored(page, a.key)).toBeNull()
    expect(await stock(page, a.inventoryId)).toBe(6)
  } finally {
    gate.release()
    await page.unroute('**/api/inventory-items')
    await second.close()
  }
})

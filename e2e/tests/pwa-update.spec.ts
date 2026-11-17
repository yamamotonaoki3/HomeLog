import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './console-guard'
import { register, createHousehold } from './support/flows'
import { newUser } from './support/test-data'

const updateName = 'アプリを更新'
const confirmation = '編集中の内容は更新すると失われます。アプリを更新しますか？'
const versionOf = (page: Page) => page.locator('meta[name="pwa-test-version"]').getAttribute('content')

interface PwaObservation {
  registering: number
  updating: number
  updated: number
  failures: number
  connectivity: string[]
}
type ObservedWindow = Window & { pwaObservation: PwaObservation }

// Fixtureだけでnative promiseの完了を観測し、製品の通信や戻り値は変更しない。
async function observePwaStartup(page: Page) {
  await page.addInitScript(() => {
    const observation: PwaObservation = { registering: 0, updating: 0, updated: 0, failures: 0, connectivity: [] }
    ;(window as ObservedWindow).pwaObservation = observation
    const register = ServiceWorkerContainer.prototype.register
    ServiceWorkerContainer.prototype.register = function (...args) {
      const promise = register.apply(this, args)
      observation.registering++
      void promise.then(() => { observation.registering-- }, () => { observation.registering--; observation.failures++ })
      return promise
    }
    const update = ServiceWorkerRegistration.prototype.update
    ServiceWorkerRegistration.prototype.update = function (...args) {
      const promise = update.apply(this, args)
      observation.updating++
      void promise.then(() => { observation.updating--; observation.updated++ }, () => { observation.updating--; observation.failures++ })
      return promise
    }
    window.addEventListener('offline', () => observation.connectivity.push('offline'))
    window.addEventListener('online', () => observation.connectivity.push('online'))
  })
}

async function startupCompleted(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const state = (window as ObservedWindow).pwaObservation
    return state.updated > 0 && state.registering === 0 && state.updating === 0 && state.failures === 0
  })).toBe(true)
  expect(await versionOf(page)).toBe('a')
}

// 検証失敗時にも認証値をログへ出さず、対象キーの完全一致をdigestで照合する。
async function storageDigest(page: Page) {
  return page.evaluate(async () => {
    const keys = Object.keys(localStorage).filter(key => /^(homelog\.(accessToken|refreshToken)$|homelog\.(shoppingPending|menuOperation)\.v1:)/.test(key)).sort()
    const encoded = new TextEncoder().encode(JSON.stringify(keys.map(key => [key, localStorage.getItem(key)])))
    const digest = await crypto.subtle.digest('SHA-256', encoded)
    return { count: keys.length, hash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') }
  })
}

async function verifyHeader(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 })
  const controls = [
    page.locator('.nav-logo'),
    page.getByRole('button', { name: updateName, exact: true }),
    page.getByRole('img', { name: '通知アラーム（0件）', exact: true }),
    page.getByRole('link', { name: '設定を開く', exact: true }),
    page.locator('.header-account-button'),
  ]
  const boxes = []
  for (const control of controls) {
    await expect(control).toBeVisible()
    const box = await control.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    boxes.push(box!)
  }
  const columnGap = await page.locator('.nav-inner').evaluate(el => parseFloat(getComputedStyle(el).columnGap))
  const accountGap = boxes[4].x - (boxes[3].x + boxes[3].width)
  expect(Math.abs(accountGap - columnGap)).toBeLessThan(1)
  expect(boxes[1].width).toBeGreaterThanOrEqual(44)
  expect(boxes[1].height).toBeGreaterThanOrEqual(44)
  expect(boxes[4].width).toBeGreaterThanOrEqual(44)
  expect(boxes[4].width).toBeLessThanOrEqual(144)
  if (width >= 390) {
    expect(await page.locator('.header-account-name').evaluate(name => name.scrollWidth > name.clientWidth)).toBe(true)
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j]
    expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  expect(await controls[1].evaluate(button => button.closest('a') === null)).toBe(true)
  await expect(controls[1].locator('svg')).toBeVisible()
}

// WindowsでwebServerが強制終了される場合も、一時buildを先に削除する。
test.afterAll(async ({ request }) => {
  expect((await request.post('/__pwa_fixture/cleanup')).status()).toBe(204)
})

test('旧PWAからの移行と二版の明示更新で入力・認証・pending・別タブを守る (#561)', async ({ page: legacy, context, request, consoleGuard }) => {
  consoleGuard.watch(legacy)
  await legacy.goto('/')
  await expect.poll(() => versionOf(legacy)).toBe('legacy')
  await expect.poll(() => legacy.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated')
  await legacy.getByLabel('旧画面の入力').fill('[E2E_TEST] old draft')
  const oldOrigin = await legacy.evaluate(() => performance.timeOrigin)
  const candidateWorker = context.waitForEvent('serviceworker')
  expect((await request.post('/__pwa_fixture/version', { data: { version: 'a' } })).status()).toBe(204)
  await legacy.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update() })
  const nextWorker = await candidateWorker
  await expect.poll(() => legacy.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed')
  expect(await versionOf(legacy)).toBe('legacy')
  expect(await legacy.evaluate(() => performance.timeOrigin)).toBe(oldOrigin)
  await expect(legacy.getByLabel('旧画面の入力')).toHaveValue('[E2E_TEST] old draft')
  await expect(legacy.getByRole('button', { name: updateName, exact: true })).toHaveCount(0)
  // 旧画面にUIは遡及追加できない。すべての旧clientを閉じると新方式SWがactivateする。
  await nextWorker.evaluate(() => {
    const state = globalThis as typeof globalThis & { pwaActivated?: boolean }
    state.pwaActivated = false
    self.addEventListener('activate', () => { state.pwaActivated = true }, { once: true })
  })
  await legacy.close()
  await expect.poll(() => nextWorker.evaluate(() => (globalThis as typeof globalThis & { pwaActivated?: boolean }).pwaActivated)).toBe(true)

  const first = await context.newPage()
  await observePwaStartup(first)
  consoleGuard.watch(first)
  consoleGuard.allow({ url: /\/api\/households\/me$/, message: 'Failed to load resource: the server responded with a status of 404 (Not Found)' })
  const user = { ...newUser('pwa'), displayName: 'e2euser_' + 'A'.repeat(42) }
  await register(first, user)
  await createHousehold(first, '[E2E_TEST] PWA household')
  await expect.poll(() => versionOf(first)).toBe('a')
  await expect(first.getByRole('button', { name: updateName, exact: true })).toHaveCount(0)
  await first.evaluate(async () => {
    const headers = { Authorization: `Bearer ${localStorage.getItem('homelog.accessToken')}` }
    const me = await fetch('/api/auth/me', { headers }).then(response => response.json())
    const household = await fetch('/api/households/me', { headers }).then(response => response.json())
    const scope = { actorUserId: me.id, householdId: household.id, version: 1, createdAt: new Date().toISOString() }
    localStorage.setItem(`homelog.shoppingPending.v1:${me.id}:${household.id}`, JSON.stringify({ ...scope, requestId: '12345678-1234-4234-8234-123456789012', items: [{ id: 1, purchasedQuantity: 1, expectedPurchaseRevision: 0 }] }))
    localStorage.setItem(`homelog.menuOperation.v1:${me.id}:${household.id}`, JSON.stringify({ ...scope, kind: 'consume', entryId: 1, body: { requestId: '22345678-1234-4234-8234-123456789012', expectedRevision: 0 } }))
  })
  const stored = await storageDigest(first)
  expect(stored.count).toBe(4)
  await first.goto('/settings/account')
  await expect(first.getByRole('textbox', { name: '表示名', exact: true })).toHaveValue(user.displayName)
  await first.getByRole('textbox', { name: '表示名', exact: true }).fill('e2euser_unsaved_A')
  const second = await context.newPage()
  await observePwaStartup(second)
  consoleGuard.watch(second)
  await second.goto('/settings/account')
  await expect(second.getByRole('textbox', { name: '表示名', exact: true })).toHaveValue(user.displayName)
  await second.getByRole('textbox', { name: '表示名', exact: true }).fill('e2euser_unsaved_B')
  const secondOrigin = await second.evaluate(() => performance.timeOrigin)

  // 両tabがAの起動チェックを終えた後、実際の接続復帰でthrottleを解除する。
  await Promise.all([startupCompleted(first), startupCompleted(second)])
  await context.setOffline(true)
  for (const page of [first, second]) {
    await expect.poll(() => page.evaluate(() => ({
      online: navigator.onLine,
      events: (window as ObservedWindow).pwaObservation.connectivity,
    }))).toEqual({ online: false, events: ['offline'] })
  }
  expect((await request.post('/__pwa_fixture/version', { data: { version: 'b' } })).status()).toBe(204)
  await context.setOffline(false)
  for (const page of [first, second]) {
    await expect.poll(() => page.evaluate(() => ({
      online: navigator.onLine,
      events: (window as ObservedWindow).pwaObservation.connectivity,
    }))).toEqual({ online: true, events: ['offline', 'online'] })
  }
  const updateFirst = first.getByRole('button', { name: updateName, exact: true })
  const updateSecond = second.getByRole('button', { name: updateName, exact: true })
  await expect(updateFirst).toBeEnabled()
  await expect(updateSecond).toBeEnabled()
  for (const width of [1280, 390, 320]) await verifyHeader(first, width)
  const dir = process.env.PWA_UPDATE_SCREENSHOT_DIR
  if (dir) {
    await mkdir(dir, { recursive: true })
    await first.screenshot({ path: join(dir, 'pwa-update-ready-320.png'), fullPage: true })
  }

  const firstOrigin = await first.evaluate(() => performance.timeOrigin)
  const cancelled = first.waitForEvent('dialog')
  const cancelClick = updateFirst.tap()
  const cancelDialog = await cancelled
  expect(cancelDialog.message()).toBe(confirmation)
  await cancelDialog.dismiss()
  await cancelClick
  await expect(first.getByRole('textbox', { name: '表示名', exact: true })).toHaveValue('e2euser_unsaved_A')
  expect(await first.evaluate(() => performance.timeOrigin)).toBe(firstOrigin)
  expect(await versionOf(first)).toBe('a')
  await expect(updateFirst).toBeEnabled()

  const accepted = first.waitForEvent('dialog')
  const updateClick = updateFirst.tap()
  const updateDialog = await accepted
  expect(updateDialog.message()).toBe(confirmation)
  await updateDialog.accept()
  await updateClick
  await expect.poll(() => versionOf(first)).toBe('b')
  await expect(updateFirst).toHaveCount(0)
  await expect(first.locator('.header-account-name')).toHaveText(user.displayName)
  expect(await storageDigest(first)).toEqual(stored)

  expect(await second.evaluate(() => performance.timeOrigin)).toBe(secondOrigin)
  expect(await versionOf(second)).toBe('a')
  await expect(second.getByRole('textbox', { name: '表示名', exact: true })).toHaveValue('e2euser_unsaved_B')
  await expect(updateSecond).toBeEnabled()
  const secondAccepted = second.waitForEvent('dialog')
  const secondClick = updateSecond.tap()
  const secondDialog = await secondAccepted
  expect(secondDialog.message()).toBe(confirmation)
  await secondDialog.accept()
  await secondClick
  await expect.poll(() => versionOf(second)).toBe('b')
  await expect(updateSecond).toHaveCount(0)
  expect(await storageDigest(second)).toEqual(stored)
})

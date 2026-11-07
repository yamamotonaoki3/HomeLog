import { test, expect } from './console-guard'
import type { Page } from '@playwright/test'
import { openInventoryDetails, setupUserWithHousehold } from './support/flows'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

async function setup(page: Page, label: string, second = false) {
  await setupUserWithHousehold(page, label)
  const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
  const headers = { Authorization: 'Bearer ' + token }
  const categoryResponse = await page.request.get('/api/zaiko-categories', { headers })
  expect(categoryResponse.ok()).toBe(true)
  const categories = await categoryResponse.json() as { id: number }[]
  const items: { id: number; name: string }[] = []
  for (const [index, suffix] of (second ? ['A', 'B'] : ['A']).entries()) {
    const name = '[E2E_TEST] 数量安全' + suffix
    const response = await page.request.post('/api/inventory-items', { headers, data: { name, categoryId: categories[0].id, storeId: null, quantity: index, threshold: 1 } })
    expect(response.status()).toBe(201)
    items.push(await response.json())
  }
  await page.goto('/zaiko')
  const item = items[0]
  const row = page.getByRole('button', { name: item.name + 'の詳細', exact: true })
  await row.click()
  const operations = page.getByRole('region', { name: item.name + 'の数量変更', exact: true })
  await expect(operations).toBeVisible()
  return { headers, items, item, row, operations }
}

test('実加算後500でもGET結果や開閉で停止を解除せず同じdeltaを再送しない', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  const { headers, items, item, row, operations } = await setup(page, 'quantity_unknown', true)
  const path = '/api/inventory-items/' + item.id + '/quantity'
  consoleGuard.allow({ url: new RegExp(path + '$'), message: /500 \(Internal Server Error\)/ })
  const deltas: number[] = []
  await page.route('**' + path, async route => {
    deltas.push(route.request().postDataJSON().delta)
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    expect((await response.json()).quantity).toBe(2.5)
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'INTERNAL_ERROR', message: '[E2E_TEST] committed response lost' }) })
  })
  await operations.getByLabel('増減量', { exact: true }).fill('2.5')
  await operations.getByRole('button', { name: '適用', exact: true }).click()
  await expect(row.locator('.inventory-list-quantity')).toHaveText('2.5')
  const assertStopped = async () => {
    await expect(operations.getByRole('alert')).toContainText('数量変更を停止')
    await expect(operations.getByRole('button', { name: '適用', exact: true })).toBeDisabled()
    await expect(operations.getByLabel('増減量', { exact: true })).toHaveValue('2.5')
    await expect(operations.getByRole('button', { name: item.name + 'を増やす', exact: true })).toBeDisabled()
    await expect(operations.getByRole('button', { name: item.name + 'を減らす', exact: true })).toBeDisabled()
    expect(deltas).toEqual([2.5])
  }
  await assertStopped()
  await row.click()
  await row.click()
  await assertStopped()
  const secondRow = page.getByRole('button', { name: items[1].name + 'の詳細', exact: true })
  await secondRow.click()
  const secondRegion = page.getByRole('region', { name: items[1].name + 'の数量変更', exact: true })
  await secondRegion.getByRole('button', { name: items[1].name + 'を増やす', exact: true }).click()
  await expect(secondRow.locator('.inventory-list-quantity')).toHaveText('2.0')
  await row.click()
  await assertStopped()
  const search = page.getByTestId('inventory-panel').getByRole('searchbox', { name: 'キーワード検索', exact: true })
  await search.fill(items[1].name)
  await expect(row).toHaveCount(0)
  await search.clear()
  await expect(row).toBeVisible()
  if (await row.getAttribute('aria-expanded') !== 'true') await row.click()
  await assertStopped()
  const tabs = page.getByRole('navigation', { name: '在庫管理関連機能' })
  await tabs.getByRole('link', { name: '買い物リスト', exact: true }).click()
  await tabs.getByRole('link', { name: '在庫一覧', exact: true }).click()
  await assertStopped()
  const detail = await openInventoryDetails(page, row)
  await expect(detail).toContainText('数量変更を停止')
  await expect(detail.getByRole('button', { name: item.name + 'を増やす', exact: true })).toBeDisabled()
  await expect(detail.getByRole('button', { name: item.name + 'を減らす', exact: true })).toBeDisabled()
  await detail.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await assertStopped()
  const response = await page.request.get('/api/inventory-items', { headers })
  expect(response.ok()).toBe(true)
  expect(await response.json()).toEqual([expect.objectContaining({ id: item.id, quantity: 2.5 }), expect.objectContaining({ id: items[1].id, quantity: 2 })])
  expect(deltas).toEqual([2.5])
})

test('実APIの未更新400はdraftを保持し訂正した正の増減量だけ明示適用できる', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  const { headers, item, row, operations } = await setup(page, 'quantity_rejected')
  const path = '/api/inventory-items/' + item.id + '/quantity'
  consoleGuard.allow({ url: new RegExp(path + '$'), message: /400 \(Bad Request\)/ })
  const deltas: number[] = []
  page.on('request', request => { if (request.method() === 'PATCH' && new URL(request.url()).pathname === path) deltas.push(request.postDataJSON().delta) })
  await operations.getByLabel('増減量', { exact: true }).fill('-1')
  const rejection = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'PATCH')
  await operations.getByRole('button', { name: '適用', exact: true }).click()
  expect((await rejection).status()).toBe(400)
  await expect(operations.getByRole('alert')).toContainText('在庫個数が範囲外です')
  await expect(operations.getByLabel('増減量', { exact: true })).toHaveValue('-1')
  await expect(row.locator('.inventory-list-quantity')).toHaveText('0.0')
  await operations.getByLabel('増減量', { exact: true }).fill('2.5')
  await operations.getByRole('button', { name: '適用', exact: true }).click()
  await expect(row.locator('.inventory-list-quantity')).toHaveText('2.5')
  await expect(operations.getByLabel('増減量', { exact: true })).toHaveValue('')
  expect(deltas).toEqual([-1, 2.5])
  const response = await page.request.get('/api/inventory-items', { headers })
  expect(response.ok()).toBe(true)
  expect(await response.json()).toEqual([expect.objectContaining({ id: item.id, quantity: 2.5 })])
})

test('既知の加算成功後GET失敗は適用済みと表示し空になったdraftを再加算しない', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  const { headers, item, row, operations } = await setup(page, 'quantity_saved_get_failed')
  const path = '/api/inventory-items/' + item.id + '/quantity'
  consoleGuard.allow({ url: /\/api\/inventory-items$/, message: /500 \(Internal Server Error\)/ })
  let committed = false
  let failedGets = 0
  let calls = 0
  await page.route('**/api/inventory-items', async route => {
    if (route.request().method() === 'GET' && committed && failedGets === 0) {
      failedGets++
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'INTERNAL_ERROR', message: '[E2E_TEST] refresh failed' }) })
    } else await route.continue()
  })
  await page.route('**' + path, async route => {
    calls++
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    committed = true
    await route.fulfill({ response })
  })
  await operations.getByLabel('増減量', { exact: true }).fill('2.5')
  await operations.getByRole('button', { name: '適用', exact: true }).click()
  await expect(page.getByText('在庫個数を更新しました。一覧の再取得に失敗しました', { exact: true })).toBeVisible()
  await expect(operations.getByLabel('増減量', { exact: true })).toHaveValue('')
  await expect(operations).not.toContainText('数量変更の結果を確認できません')
  await operations.getByRole('button', { name: '適用', exact: true }).click()
  await expect(operations.getByRole('alert')).toContainText('増減量')
  expect(calls).toBe(1)
  expect(failedGets).toBe(1)
  const response = await page.request.get('/api/inventory-items', { headers })
  expect(response.ok()).toBe(true)
  expect(await response.json()).toEqual([expect.objectContaining({ id: item.id, quantity: 2.5 })])
  await page.reload()
  await expect(row.locator('.inventory-list-quantity')).toHaveText('2.5')
  expect(calls).toBe(1)
})

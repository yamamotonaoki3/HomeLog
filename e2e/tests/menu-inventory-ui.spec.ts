import { expect, test } from './console-guard'
import { newUser } from './support/test-data'
import { randomUUID } from 'node:crypto'
import { login, openAccountMenu, setupUserWithHousehold } from './support/flows'
import { expectNoHorizontalOverflow, readMeals, readStocks, seedOriginal, seedPlannedStock, menuHeaders } from './support/menu-inventory'
import type { Locator, Page } from '@playwright/test'

async function recordMeal(page: Page, row: Locator) {
  await row.getByRole('button', { name: '食べた', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '食事を記録', exact: true })
  await expect(dialog).toContainText('減らす数 1')
  await dialog.getByRole('button', { name: '食べたことを記録', exact: true }).click()
  await expect(dialog).toBeHidden()
}
async function undoMeal(page: Page, row: Locator) {
  await row.getByRole('button', { name: /^(?:1回)?取り消す$/ }).click()
  const dialog = page.getByRole('dialog', { name: '食事を取り消す', exact: true })
  await expect(dialog).toContainText('戻す数 1')
  await dialog.getByRole('button', { name: '食事を取り消して戻す', exact: true }).click()
  await expect(dialog).toBeHidden()
}
async function openEditor(page: Page, name: string) {
  const details = page.getByRole('button', { name: name + 'の詳細', exact: true })
  if (await details.getAttribute('aria-expanded') !== 'true') await details.click()
  await page.getByRole('button', { name: name + 'の詳細を編集', exact: true }).click()
  return page.getByRole('dialog', { name: '在庫の詳細編集', exact: true })
}

for (const width of [1280, 390, 320]) {
  test(`在庫を新規名と既存レシピに割り当て献立を一行表示する ${width}px`, async ({ page, consoleGuard }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, `menu_plan_ui_${width}`)
    const originalTitle = '[E2E_TEST] 登録済みの料理'
    const recipeId = await seedOriginal(page, originalTitle)
    const stockName = '[E2E_TEST] 鶏むね肉' + width
    const first = '[E2E_TEST] カレーライス' + '長い料理名'.repeat(8)
    const second = '[E2E_TEST] 親子丼'
    await page.goto('/zaiko')
    await page.getByRole('button', { name: '在庫を登録', exact: true }).click()
    await page.getByLabel('品名', { exact: true }).fill(stockName)
    await page.getByLabel('在庫個数', { exact: true }).fill('5')
    await page.getByRole('checkbox', { name: '献立と連携する', exact: true }).check()
    for (const title of [first, second]) {
      await page.getByLabel('新しい料理名', { exact: true }).fill(title)
      await page.getByRole('button', { name: '料理を追加', exact: true }).click()
      await page.getByLabel(title + 'の残り予定回数', { exact: true }).fill('2')
    }
    await page.getByLabel(first + 'のメモ', { exact: true }).fill('辛口')
    await page.getByLabel(second + 'のメモ', { exact: true }).fill('昼食用')
    await page.getByRole('radio', { name: '登録済みレシピから選ぶ', exact: true }).check()
    await page.getByLabel('レシピを検索', { exact: true }).fill('登録済み')
    await page.getByRole('checkbox', { name: originalTitle, exact: true }).check()
    await page.getByRole('button', { name: '選んだレシピを追加', exact: true }).click()
    await page.getByLabel(originalTitle + 'の残り予定回数', { exact: true }).fill('1')
    await expect(page.getByRole('checkbox', { name: '献立と連携する', exact: true })).toHaveCount(1)
    await expect(page.getByRole('button', { name: '連携設定を保存', exact: true })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
    const countInput = page.getByLabel(first + 'の残り予定回数', { exact: true })
    expect(await countInput.evaluate(input => parseFloat(getComputedStyle(input).fontSize))).toBeGreaterThanOrEqual(16)
    expect(await countInput.evaluate(input => input.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
    await countInput.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('menu-plan-editor.png'), fullPage: true })
    const createdResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/inventory-items' && response.request().method() === 'POST')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    const response = await createdResponse
    expect(response.status()).toBe(201)
    const created = await response.json()
    expect(created.quantity).toBe(5)
    expect(response.request().postDataJSON().menuPlan.links).toEqual([
      { newRecipeTitle: first, remainingCount: 2, memo: '辛口', carryEnabled: false },
      { newRecipeTitle: second, remainingCount: 2, memo: '昼食用', carryEnabled: false },
      { recipeId, remainingCount: 1, memo: null, carryEnabled: false },
    ])
    const stock = (await readStocks(page)).find(item => item.id === created.id)!
    expect(stock).toMatchObject({ quantity: 5, menuPlanEnabled: true })
    expect(stock.menuLinks).toHaveLength(3)
    await page.goto('/menu')
    const row = page.getByRole('list', { name: 'この週の献立' }).getByRole('listitem').filter({ hasText: first })
    const title = row.locator('.menu-title-clamped')
    await expect(title).toHaveText(first + '×2｜辛口')
    expect(await title.evaluate(element => element.getBoundingClientRect().height <= parseFloat(getComputedStyle(element).lineHeight) + 1)).toBe(true)
    await expect(row.getByRole('button', { name: '食べた', exact: true })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath('menu-plan-single-line.png'), fullPage: true })
    await row.locator('.menu-title-toggle').click()
    await expect(row.getByRole('button', { name: '食べた', exact: true })).toBeEnabled()
    if (width === 1280) {
      await recordMeal(page, row)
      await expect(row.locator('.menu-title-toggle')).toContainText('×1｜辛口')
      expect((await readStocks(page)).find(item => item.id === created.id)?.quantity).toBe(4)
      await recordMeal(page, row)
      await expect(row.locator('.menu-title-toggle')).toContainText('×0｜辛口')
      expect((await readStocks(page)).find(item => item.id === created.id)?.quantity).toBe(3)
      await undoMeal(page, row)
      await expect(row.locator('.menu-title-toggle')).toContainText('×1｜辛口')
      await undoMeal(page, row)
      await expect(row.locator('.menu-title-toggle')).toContainText('×2｜辛口')
      expect((await readStocks(page)).find(item => item.id === created.id)?.quantity).toBe(5)
    }
    await expectNoHorizontalOverflow(page)
  })
}

test('既存在庫の編集はキャンセルで全不変、超過は送信せず、関連だけを一括解除する', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  await setupUserWithHousehold(page, 'menu_plan_edit')
  const sharedRecipe = await seedOriginal(page, '[E2E_TEST] 残す原本')
  const stock = await seedPlannedStock(page, '[E2E_TEST] 編集する鶏肉', 5, sharedRecipe, 2)
  const other = await seedPlannedStock(page, '[E2E_TEST] 別の在庫', 4, sharedRecipe, 4)
  const title = stock.menuLinks[0].recipeTitle
  const oldMeal = (await readMeals(page)).find(entry => entry.inventoryLinkage?.inventoryItemId === stock.id)!
  await page.goto('/zaiko')
  const writes: string[] = []
  page.on('request', request => { if (/\/api\/(?:inventory-items|inventory-menu-links|recipes)(?:\/|$)/.test(new URL(request.url()).pathname) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.method() + ' ' + new URL(request.url()).pathname) })
  let dialog = await openEditor(page, stock.name)
  await dialog.getByLabel('在庫個数', { exact: true }).fill('4')
  await dialog.getByLabel(title + 'の残り予定回数', { exact: true }).fill('3')
  await dialog.getByLabel(title + 'のメモ', { exact: true }).fill('保存しない')
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(writes).toEqual([])
  expect((await readStocks(page)).find(item => item.id === stock.id)).toEqual(stock)
  dialog = await openEditor(page, stock.name)
  await dialog.getByLabel(title + 'の残り予定回数', { exact: true }).fill('6')
  const save = dialog.getByRole('button', { name: '保存', exact: true })
  if (await save.isEnabled()) await save.click()
  await expect(dialog).toBeVisible()
  expect(writes).toEqual([])
  expect((await readStocks(page)).find(item => item.id === stock.id)).toEqual(stock)
  await dialog.getByLabel(title + 'の残り予定回数', { exact: true }).fill('2')
  await dialog.getByRole('button', { name: title + 'の関連を外す', exact: true }).click()
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/inventory-items/' + stock.id && response.request().method() === 'PUT')
  await save.click()
  expect((await saved).status()).toBe(200)
  await expect(dialog).toBeHidden()
  expect(writes).toEqual(['PUT /api/inventory-items/' + stock.id])
  expect((await readStocks(page)).find(item => item.id === stock.id)).toMatchObject({ quantity: 5, menuLinks: [] })
  expect((await readStocks(page)).find(item => item.id === other.id)).toMatchObject({ quantity: 4, menuLinks: [{ id: other.menuLinks[0].id, remainingCount: 4 }] })
  const recipes = await page.request.get('/api/recipes', { headers: await menuHeaders(page) })
  expect(recipes.status()).toBe(200)
  expect((await recipes.json()).some((recipe: { id: number }) => recipe.id === sharedRecipe)).toBe(true)
  expect((await readMeals(page)).some(entry => entry.id === oldMeal.id)).toBe(false)
  await page.goto('/menu')
  await expect(page.getByRole('list', { name: 'この週の献立' }).getByRole('listitem').filter({ hasText: title })).toHaveCount(1)
})

test('保存後の応答喪失をreload・別世帯login後も同一要求で一度だけ回復する', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  const actor = await setupUserWithHousehold(page, 'menu_unknown_a')
  const stock = await seedPlannedStock(page, '[E2E_TEST] 回復する一食')
  const meal = (await readMeals(page)).find(entry => entry.inventoryLinkage?.inventoryItemId === stock.id)!
  const stranger = newUser('menu_unknown_b')
  expect((await page.request.post('/api/auth/register', { data: stranger })).status()).toBe(201)
  const authB = await page.request.post('/api/auth/login', { data: { email: stranger.email, password: stranger.password } })
  expect(authB.status()).toBe(200)
  const headersB = { Authorization: `Bearer ${(await authB.json()).accessToken}` }
  expect((await page.request.post('/api/households', { headers: headersB, data: { name: '[E2E_TEST] 別世帯' } })).status()).toBe(201)
  const path = `/api/menu-entries/${meal.id}/consume`
  const sent: { requestId: string; expectedRevision: number }[] = []
  page.on('request', request => { if (new URL(request.url()).pathname === path && request.method() === 'POST') sent.push(request.postDataJSON()) })
  consoleGuard.allow({ url: new RegExp(path + '$'), message: 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)' })
  await page.route('**' + path, async route => {
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'EXTERNAL_SERVICE_ERROR', message: '[E2E_TEST] 保存後の応答喪失', details: [] }) })
  })
  await page.goto('/menu')
  const row = page.getByRole('list', { name: 'この週の献立' }).getByRole('listitem').filter({ hasText: stock.name + 'の料理' })
  await row.locator('.menu-title-toggle').click()
  await row.getByRole('button', { name: '食べた', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '食事を記録', exact: true })
  await dialog.getByRole('button', { name: '食べたことを記録', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click()
  const recover = page.getByRole('button', { name: '前回の結果を確認', exact: true })
  await expect(recover).toBeEnabled()
  expect(sent).toHaveLength(1)
  expect((await readStocks(page)).find(item => item.id === stock.id)?.quantity).toBe(2)
  await page.unroute('**' + path)
  await page.reload()
  await expect(recover).toBeEnabled()
  expect(sent).toHaveLength(1)
  await (await openAccountMenu(page)).getByRole('button', { name: 'ログアウト', exact: true }).click()
  await login(page, stranger)
  await expect(page).not.toHaveURL(/\/login$/)
  await page.goto('/menu')
  await expect(page.getByRole('list', { name: 'この週の献立' })).toBeVisible()
  await expect(recover).toHaveCount(0)
  expect(await readStocks(page)).toEqual([])
  expect(await readMeals(page)).toEqual([])
  expect(sent).toHaveLength(1)
  expect((await page.request.post(path, { headers: headersB, data: { requestId: randomUUID(), expectedRevision: 1 } })).status()).toBe(404)
  await (await openAccountMenu(page)).getByRole('button', { name: 'ログアウト', exact: true }).click()
  await login(page, actor)
  await expect(page).not.toHaveURL(/\/login$/)
  await page.goto('/menu')
  await expect(recover).toBeEnabled()
  await recover.click()
  await expect(recover).toHaveCount(0)
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual(sent[0])
  expect((await readStocks(page)).find(item => item.id === stock.id)?.quantity).toBe(2)
  expect((await readMeals(page)).find(entry => entry.id === meal.id)?.inventoryLinkage).toMatchObject({ mealState: 'eaten', mealRevision: 1, remainingCount: 2 })
})

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './console-guard'
import { confirmShoppingPurchase, setupUserWithHousehold } from './support/flows'
import { expectActionTargets44 } from './support/list-row'

test.use({ trace: 'off' })

type PurchaseBody = { requestId: string; items: { id: number; purchasedQuantity: number; expectedPurchaseRevision: number }[] }
for (const width of [1280, 390, 320]) {
  test('予定・部分残数・未対象保持と店舗別固定購入操作 ' + width + 'px (#421)', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await page.setViewportSize({ width, height: 844 })
    await setupUserWithHousehold(page, 'planned_ui_' + width)
    const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('homelog.accessToken')) }
    const categoryName = '[E2E_TEST] 分類' + '長い分類'.repeat(6)
    const categoryResponse = await page.request.post('/api/zaiko-categories', { headers, data: { name: categoryName } })
    expect(categoryResponse.status()).toBe(201)
    const categoryId = (await categoryResponse.json()).id
    const storeNames = ['[E2E_TEST] 店舗A' + '長い店名'.repeat(6), '[E2E_TEST] 店舗B']
    const storeIds: number[] = []
    for (const name of storeNames) {
      const response = await page.request.post('/api/stores', { headers, data: { name } })
      expect(response.status()).toBe(201)
      storeIds.push((await response.json()).id)
    }
    const names = ['[E2E_TEST] 部分購入' + '長い商品名'.repeat(5), '[E2E_TEST] 実購入0保持', '[E2E_TEST] 手動超過', '[E2E_TEST] 未チェック保持']
    const inventoryIds: number[] = []
    for (let index = 0; index < names.length + 8; index++) {
      const name = names[index] ?? '[E2E_TEST] 末尾の未購入品目' + index
      const response = await page.request.post('/api/inventory-items', { headers, data: {
        name, categoryId, storeId: index === 0 ? storeIds[0] : index === 1 ? storeIds[1] : null,
        quantity: index === 2 || index === 3 ? 5 : 0, threshold: index === 0 ? 1 : index === 1 ? 5 : 0, price: index === 2 ? 980 : 123,
      } })
      expect(response.status()).toBe(201)
      const id = (await response.json()).id
      inventoryIds.push(id)
      if (index === 2 || index === 3) expect((await page.request.post('/api/shopping-list-items', { headers, data: { inventoryItemId: id } })).status()).toBe(201)
    }
    const initialListResponse = await page.request.get('/api/shopping-list-items', { headers })
    expect(initialListResponse.status()).toBe(200)
    const initialList = await initialListResponse.json() as { id: number; inventoryItemId: number; plannedQuantity: number; purchaseRevision: number }[]
    expect(initialList.every(item => item.plannedQuantity === 1 && item.purchaseRevision === 0)).toBe(true)
    const entryIds = inventoryIds.map(id => initialList.find(item => item.inventoryItemId === id)!.id)
    const posts: PurchaseBody[] = []
    let oldPosts = 0
    let planWrites = 0
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/shopping-list-items/purchases')) posts.push(request.postDataJSON())
      if (request.method() === 'POST' && request.url().endsWith('/shopping-list-items/update')) oldPosts++
      if (request.method() === 'PATCH' && /\/shopping-list-items\/\d+$/.test(request.url())) planWrites++
    })
    await page.goto('/zaiko/shopping')
    const panel = page.getByTestId('shopping-panel')
    const reflect = panel.getByRole('button', { name: '購入を反映', exact: true })
    const row = (index: number) => panel.getByRole('button', { name: names[index] + 'の詳細', exact: true })
    const checkbox = (index: number) => panel.getByRole('checkbox', { name: names[index] + 'を購入済みにする', exact: true })
    const detail = page.getByRole('dialog', { name: '買い物詳細', exact: true })
    const close = detail.getByRole('button', { name: '閉じる', exact: true })
    const initialClose = detail.getByRole('button', { name: '買い物詳細を閉じる', exact: true })
    const actual = (index: number) => detail.getByLabel(names[index] + 'の実購入数', { exact: true })
    const planned = (index: number) => detail.getByLabel(names[index] + 'の予定数', { exact: true })
    const screenshot = async (name: string) => {
      const dir = process.env.SHOPPING_PLANNED_SCREENSHOT_DIR
      if (dir) { await mkdir(dir, { recursive: true }); await page.screenshot({ path: join(dir, name + '-' + width + '.png') }) }
    }
    await expect(row(0)).toBeVisible()
    await expect(reflect).toBeDisabled()
    for (const storeName of [...storeNames, '店舗未指定']) await expect(panel.getByRole('region', { name: storeName + 'の買い物', exact: true })).toBeVisible()
    await expect(row(0).locator('input,button')).toHaveCount(0)
    await expectActionTargets44(panel)
    const smallInputs = await panel.locator('input:visible, select:visible').evaluateAll(elements => elements.map(el => Number.parseFloat(getComputedStyle(el).fontSize)).filter(font => font < 16))
    expect(smallInputs).toEqual([])
    const labelBox = await checkbox(0).locator('..').boundingBox()
    expect(labelBox!.height).toBeGreaterThanOrEqual(44)
    expect(labelBox!.width).toBeGreaterThanOrEqual(44)
    await checkbox(0).focus()
    await checkbox(0).press('Space')
    await expect(checkbox(0)).toBeChecked()
    await expect(detail).toBeHidden()
    await checkbox(0).uncheck()
    await row(0).press('Enter')
    await expect(initialClose).toBeFocused()
    await expect(initialClose).toBeInViewport()
    expect(await detail.evaluate(el => el.scrollTop)).toBe(0)
    await expect(detail.getByText(names[0], { exact: true })).toBeInViewport()
    await screenshot('planned-detail-initial')
    for (const control of [planned(0), detail.getByRole('button', { name: '予定数を保存', exact: true }), detail.getByRole('button', { name: names[0] + 'を削除', exact: true }), close]) {
      await page.keyboard.press('Tab')
      await expect(control).toBeFocused()
      await expect(control).toBeInViewport()
    }
    await page.keyboard.press('Tab')
    await expect(initialClose).toBeFocused()
    await expect(initialClose).toBeInViewport()
    await expect(detail.getByText(categoryName, { exact: true })).toBeVisible()
    await expect(detail.getByText(storeNames[0], { exact: true })).toBeVisible()
    await expect(actual(0)).toBeDisabled()
    for (const bad of ['', '0', '0.01', '100000']) {
      await planned(0).fill(bad)
      await detail.getByRole('button', { name: '予定数を保存', exact: true }).click()
      await expect(detail.getByRole('alert')).toContainText('0.1')
    }
    expect(planWrites).toBe(0)
    for (const quantity of ['0.1', '3']) {
      await planned(0).fill(quantity)
      const response = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/shopping-list-items/' + entryIds[0]))
      await detail.getByRole('button', { name: '予定数を保存', exact: true }).click()
      expect((await response).status()).toBe(200)
      await expect(detail.getByRole('button', { name: '予定数を保存', exact: true })).toBeEnabled()
    }
    await expectActionTargets44(detail)
    expect(await planned(0).evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
    await screenshot('planned-detail')
    await close.click()
    await expect(row(0)).toBeFocused()
    await expect(row(0)).toBeInViewport()
    await checkbox(0).check()
    await row(0).click()
    await expect(actual(0)).toHaveValue('3')
    expect(await actual(0).evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
    for (const bad of ['', '-1', '0.01', '100000']) {
      await actual(0).fill(bad)
      await close.click()
      await expect(reflect).toBeDisabled()
      await row(0).click()
    }
    await actual(0).fill('2')
    await close.click()
    // checkedな0と、未checkedの入力途中値は購入対象に入れず保持する。
    await checkbox(1).check()
    await row(1).click()
    await actual(1).fill('0')
    await close.click()
    await checkbox(3).check()
    await row(3).click()
    await actual(3).fill('2.5')
    await close.click()
    await checkbox(3).uncheck()
    const search = panel.getByRole('searchbox', { name: '商品を探す', exact: true })
    await search.fill('該当しない品名')
    await expect(panel.getByRole('button', { name: /の詳細$/ })).toHaveCount(0)
    await expect(panel.getByText('該当する品目がありません', { exact: true })).toBeVisible()
    await search.fill('')
    await panel.getByLabel('並び替え').selectOption('store')
    const tabs = page.getByRole('navigation', { name: '在庫管理関連機能' })
    await tabs.getByRole('link', { name: '在庫一覧' }).click()
    await expect(page.locator('.shopping-purchase-bar')).toBeHidden()
    expect(await page.locator('body').evaluate(el => getComputedStyle(el).position)).not.toBe('fixed')
    await tabs.getByRole('link', { name: '買い物リスト' }).click()
    await expect(row(0)).toContainText('実購入 2')
    await row(3).click()
    await expect(actual(3)).toHaveValue('2.5')
    await expect(actual(3)).toBeDisabled()
    await close.click()
    const last = panel.getByRole('button', { name: /末尾の未購入品目.*の詳細$/ }).last()
    await last.scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect(last).toBeInViewport()
    await expect(reflect).toBeInViewport()
    const barBox = await page.locator('.shopping-purchase-bar').boundingBox()
    const navBox = await page.locator('.primary-nav').boundingBox()
    const lastBox = await last.boundingBox()
    expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(barBox!.y + 1)
    expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(navBox!.y + 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await screenshot('planned-list')
    await reflect.click()
    const confirmation = page.getByRole('dialog', { name: '購入内容の確認', exact: true })
    await expect(confirmation.getByRole('listitem')).toHaveCount(1)
    await expect(confirmation.getByRole('listitem')).toContainText(names[0])
    await expect(confirmation.locator('strong')).toHaveText('2')
    await expectActionTargets44(confirmation)
    await screenshot('planned-confirm')
    await confirmation.getByRole('button', { name: '戻る', exact: true }).click()
    await expect(reflect).toBeFocused()
    expect(posts).toHaveLength(0)
    await confirmShoppingPurchase(page)
    await expect(row(0)).toContainText('予定 1')
    await expect(checkbox(0)).not.toBeChecked()
    await expect(checkbox(1)).toBeChecked()
    expect(posts).toHaveLength(1)
    expect(posts[0]).toEqual({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), items: [{ id: entryIds[0], purchasedQuantity: 2, expectedPurchaseRevision: 2 }] })
    let inventory = await (await page.request.get('/api/inventory-items', { headers })).json()
    expect(inventory.find((item: { id: number }) => item.id === inventoryIds[0]).quantity).toBe(2)
    for (const index of [1, 3]) expect(inventory.find((item: { id: number }) => item.id === inventoryIds[index]).quantity).toBe(index === 1 ? 0 : 5)
    await row(0).click()
    await expect(planned(0)).toHaveValue('1')
    await close.click()
    await checkbox(0).check()
    await expect(row(0)).toContainText('実購入 1')
    await confirmShoppingPurchase(page)
    await expect(row(0)).toHaveCount(0)
    // 自動不足の買切りは次予定1、手動超過は実4をすべて加算する。
    await row(1).click()
    await actual(1).fill('1')
    await close.click()
    await checkbox(2).check()
    await row(2).click()
    await planned(2).fill('3')
    const manualPlanResponse = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/shopping-list-items/' + entryIds[2]))
    await detail.getByRole('button', { name: '予定数を保存', exact: true }).click()
    expect((await manualPlanResponse).status()).toBe(200)
    await expect(actual(2)).toHaveValue('1')
    await actual(2).fill('4')
    await close.click()
    await confirmShoppingPurchase(page)
    await expect(row(2)).toHaveCount(0)
    await expect(row(1)).toContainText('予定 1')
    await expect(checkbox(1)).not.toBeChecked()
    inventory = await (await page.request.get('/api/inventory-items', { headers })).json()
    expect(inventory.find((item: { id: number }) => item.id === inventoryIds[0]).quantity).toBe(3)
    expect(inventory.find((item: { id: number }) => item.id === inventoryIds[1]).quantity).toBe(1)
    expect(inventory.find((item: { id: number }) => item.id === inventoryIds[2])).toMatchObject({ quantity: 9, price: 980 })
    expect(inventory.find((item: { id: number }) => item.id === inventoryIds[3])).toMatchObject({ quantity: 5, price: 123 })
    expect(posts).toHaveLength(3)
    expect(posts[1]).toEqual({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), items: [{ id: entryIds[0], purchasedQuantity: 1, expectedPurchaseRevision: 3 }] })
    expect(posts[2]).toEqual({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), items: expect.arrayContaining([{ id: entryIds[1], purchasedQuantity: 1, expectedPurchaseRevision: 0 }, { id: entryIds[2], purchasedQuantity: 4, expectedPurchaseRevision: 1 }]) })
    expect(posts[2].items).toHaveLength(2)
    expect(new Set(posts.map(post => post.requestId)).size).toBe(3)
    expect(posts.flatMap(post => post.items).some(item => item.id === entryIds[3])).toBe(false)
    expect(oldPosts).toBe(0)
    await expect(reflect).toBeDisabled()
  })
}

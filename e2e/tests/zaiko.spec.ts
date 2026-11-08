import { expectActionTargets44 } from './support/list-row'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './console-guard'
import { confirmShoppingPurchase, openInventoryDetails, setupUserWithHousehold } from './support/flows'

test.describe('F-07/F-08 在庫・買い物リスト', () => {
  test('閾値以下の在庫が買い物リストに載り、購入すると在庫に反映される', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'zaiko')
    await page.goto('/zaiko')

    const name = '[E2E_TEST] 牛乳'
    await page.getByRole('button', { name: '在庫を登録' }).click()
    await page.getByLabel('品名').fill(name)
    await page.getByLabel('在庫個数').fill('0')
    await page.getByLabel('買い物リスト追加閾値').fill('0.5')
    await page.getByRole('button', { name: '保存' }).click()

    const inventoryRow = page.getByRole('button', { name: `${name}の詳細`, exact: true })
    const quantity = inventoryRow.locator('.inventory-list-quantity')
    await expect(quantity).toHaveText('0.0')

    const tabs = page.getByRole('navigation', { name: '在庫管理関連機能' })
    await tabs.getByRole('link', { name: '買い物リスト' }).click()
    await expect(page).toHaveURL(/\/zaiko\/shopping$/)

    const shopping = page.getByTestId('shopping-panel')
    const shoppingRow = shopping.getByRole('button', { name: `${name}の詳細`, exact: true })
    await expect(shoppingRow).toBeVisible()

    await shopping.getByRole('checkbox', { name: `${name}を購入済みにする`, exact: true }).check()
    await confirmShoppingPurchase(page)
    await expect(shoppingRow).toHaveCount(0)

    await tabs.getByRole('link', { name: '在庫一覧' }).click()
    await expect(quantity).toHaveText('1.0')
  })

  for (const width of [1280, 390, 320]) {
    test(`在庫の個数・上下ボタン操作・閾値連携・ページ幅（${width}px）`, async ({ browser, baseURL, consoleGuard }) => {
      const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, hasTouch: width < 400 })
      try {
        const page = await context.newPage()
        consoleGuard.watch(page)
        await setupUserWithHousehold(page, `zaiko_vertical_${width}`)
        const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
        expect(token).toBeTruthy()
        const categoryName = '[E2E_TEST]' + '長い分類'.repeat(10)
        const storeName = '[E2E_TEST]' + '長い店名'.repeat(10)
        const headers = { Authorization: `Bearer ${token}` }
        let seedCategoryId = 0
        for (const [path, name] of [['zaiko-categories', categoryName], ['stores', storeName]]) {
          const response = await page.request.post(`/api/${path}`, { headers, data: { name } })
          expect(response.status()).toBe(201)
          if (path === 'zaiko-categories') seedCategoryId = (await response.json()).id
        }
        const largeName = '[E2E_TEST] 大数量'
        const largeResponse = await page.request.post('/api/inventory-items', { headers, data: { name: largeName, categoryId: seedCategoryId, storeId: null, quantity: 99999.9, threshold: 0 } })
        expect(largeResponse.status()).toBe(201)
        await page.goto('/zaiko')
        const name = '[E2E_TEST]' + '長い品名'.repeat(10)
        await page.getByRole('button', { name: '在庫を登録' }).click()
        await page.getByLabel('品名', { exact: true }).fill(name)
        await page.getByLabel('カテゴリー', { exact: true }).selectOption({ label: categoryName })
        await page.locator('#inv-store').selectOption({ label: storeName })
        await page.getByLabel('在庫個数', { exact: true }).fill('1')
        await page.getByLabel('買い物リスト追加閾値').fill('0.5')
        await page.getByRole('button', { name: '保存', exact: true }).click()
        const row = page.getByTestId('inventory-panel').getByRole('button', { name: `${name}の詳細`, exact: true })
        const largeRow = page.getByRole('button', { name: largeName + 'の詳細', exact: true })
        await expect(largeRow.locator('.inventory-list-quantity')).toHaveText('99999.9')
        await expect(largeRow).toHaveAccessibleDescription('在庫数 99999.9')
        await row.click()
        await expect(row).toHaveAttribute('aria-expanded', 'true')
        const operations = page.getByRole('region', { name: name + 'の数量変更', exact: true })
        await expect(operations).toBeVisible()
        await expect(page.getByRole('dialog')).toHaveCount(0)
        const listQuantity = row.locator('.inventory-list-quantity')
        const inlinePlus = operations.getByRole('button', { name: name + 'を増やす', exact: true })
        const inlineMinus = operations.getByRole('button', { name: name + 'を減らす', exact: true })
        const inlineStep = operations.getByRole('group', { name: '増減幅' })
        const inlineDeltas: number[] = []
        page.on('request', request => { if (request.method() === 'PATCH' && /\/api\/inventory-items\/\d+\/quantity$/.test(new URL(request.url()).pathname)) inlineDeltas.push(request.postDataJSON().delta) })
        await inlinePlus.click()
        await expect(listQuantity).toHaveText('2.0')
        await inlineMinus.click()
        await expect(listQuantity).toHaveText('1.0')
        await inlineStep.getByRole('button', { name: '0.1', exact: true }).click()
        await inlinePlus.click()
        await expect(listQuantity).toHaveText('1.1')
        await inlineMinus.click()
        await expect(listQuantity).toHaveText('1.0')
        await inlineStep.getByRole('button', { name: '1', exact: true }).click()
        for (const [delta, quantity] of [['2.5', '3.5'], ['-2.5', '1.0'], ['-0.5', '0.5'], ['0.5', '1.0']]) {
          await operations.getByLabel('増減量', { exact: true }).fill(delta)
          const adjusted = page.waitForResponse(response => response.request().method() === 'PATCH' && /\/api\/inventory-items\/\d+\/quantity$/.test(new URL(response.url()).pathname))
          await operations.getByRole('button', { name: '適用', exact: true }).click()
          expect((await adjusted).status()).toBe(200)
          await expect(listQuantity).toHaveText(quantity)
          if (quantity === '0.5') {
            await expect(row.locator('.inventory-low-stock')).toHaveText('！')
            await expect(row).toHaveAccessibleDescription(/在庫数 0.5.*閾値以下/)
          } else {
            await expect(row.locator('.inventory-low-stock')).toHaveText('')
            await expect(row).not.toHaveAccessibleDescription(/閾値以下/)
          }
          await expect(operations.getByLabel('増減量', { exact: true })).toHaveValue('')
        }
        expect(inlineDeltas).toEqual([1, -1, 0.1, -0.1, 2.5, -2.5, -0.5, 0.5])
        await expectActionTargets44(page.getByTestId('inventory-panel'))
        expect(await operations.getByLabel('増減量', { exact: true }).evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
        const applyLine = await operations.getByRole('button', { name: '適用', exact: true }).evaluate(el => {
          const range = document.createRange()
          range.selectNodeContents(el)
          return { text: el.textContent, font: parseFloat(getComputedStyle(el).fontSize), tops: [...range.getClientRects()].map(rect => rect.top) }
        })
        expect(applyLine.tops.length).toBeGreaterThan(0)
        expect(Math.max(...applyLine.tops) - Math.min(...applyLine.tops), '適用ラベルは単一行: ' + JSON.stringify(applyLine)).toBeLessThan(applyLine.font / 2)
        if (process.env.ZAIKO_SCREENSHOT_DIR) {
          await mkdir(process.env.ZAIKO_SCREENSHOT_DIR, { recursive: true })
          await operations.getByRole('button', { name: '適用', exact: true }).scrollIntoViewIfNeeded()
          await page.screenshot({ path: join(process.env.ZAIKO_SCREENSHOT_DIR, 'inventory-b-actions-' + width + '.png') })
          await page.evaluate(() => window.scrollTo(0, 0))
          await page.screenshot({ path: join(process.env.ZAIKO_SCREENSHOT_DIR, 'inventory-b-' + width + '.png'), fullPage: true })
        }
        await openInventoryDetails(page, row)
        await expect(operations).toBeHidden()
        const detail = page.getByRole('dialog', { name: '在庫詳細・編集' })
        const quantity = detail.locator('.qty-value')
        await expect(quantity).toHaveText('1.0')
        await expect(detail).toContainText(categoryName)
        await expect(detail).toContainText(storeName)
        const plus = detail.getByRole('button', { name: `${name}を増やす`, exact: true })
        const minus = detail.getByRole('button', { name: `${name}を減らす`, exact: true })
        const step = detail.getByRole('group', { name: '増減幅' })
        await plus.scrollIntoViewIfNeeded()
        const boxes = await Promise.all([plus, quantity, minus, step].map((locator) => locator.boundingBox()))
        for (const box of [boxes[0], boxes[2]]) {
          expect(box!.width).toBeGreaterThanOrEqual(44)
          expect(box!.height).toBeGreaterThanOrEqual(44)
        }
        expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(boxes[0]!.x)
        expect(boxes[0]!.y + boxes[0]!.height).toBeLessThanOrEqual(boxes[2]!.y)
        expect(Math.abs(boxes[0]!.x - boxes[2]!.x)).toBeLessThan(1)
        const press = async (locator: typeof plus) => width < 400 ? locator.tap() : locator.click()
        await press(plus)
        await expect(quantity).toHaveText('2.0')
        await press(minus)
        await expect(quantity).toHaveText('1.0')
        await step.getByRole('button', { name: '0.1', exact: true }).click()
        await press(plus)
        await expect(quantity).toHaveText('1.1')
        await press(minus)
        await expect(quantity).toHaveText('1.0')
        await step.getByRole('button', { name: '1', exact: true }).click()
        await press(minus)
        await expect(quantity).toHaveText('0.0')
        let patches = 0
        page.on('request', (request) => { if (request.method() === 'PATCH') patches++ })
        await press(minus)
        await expect(page.getByText('在庫個数は0未満にできません')).toBeVisible()
        await expect(quantity).toHaveText('0.0')
        expect(patches).toBe(0)
        const tabs = page.getByRole('navigation', { name: '在庫管理関連機能' })
        await detail.getByRole('button', { name: 'キャンセル' }).click()
        await tabs.getByRole('link', { name: '買い物リスト' }).click()
        const shoppingRow = page.getByTestId('shopping-panel').getByRole('button', { name: `${name}の詳細`, exact: true })
        await expect(shoppingRow).toBeVisible()
        await tabs.getByRole('link', { name: '在庫一覧' }).click()
        await openInventoryDetails(page, row)
        await press(plus)
        await expect(quantity).toHaveText('1.0')
        await detail.getByRole('button', { name: 'キャンセル' }).click()
        await tabs.getByRole('link', { name: '買い物リスト' }).click()
        await expect(shoppingRow).toHaveCount(0)
        await tabs.getByRole('link', { name: '在庫一覧' }).click()
        await page.reload()
        await openInventoryDetails(page, row)
        await expect(quantity).toHaveText('1.0')
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
        expect(await row.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
        if (process.env.ZAIKO_SCREENSHOT_DIR) {
          await mkdir(process.env.ZAIKO_SCREENSHOT_DIR, { recursive: true })
          await page.screenshot({ path: join(process.env.ZAIKO_SCREENSHOT_DIR, `zaiko-${width}.png`), fullPage: true })
        }
      } finally {
        await context.close()
      }
    })
  }
})

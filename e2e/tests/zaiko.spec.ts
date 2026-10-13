import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

test.describe('F-07/F-08 在庫・買い物リスト', () => {
  test('閾値以下の在庫が買い物リストに載り、購入すると在庫に反映される', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'zaiko')
    await page.goto('/zaiko')

    const name = '[E2E_TEST] 牛乳'
    await page.getByRole('button', { name: '在庫を登録' }).click()
    await page.getByLabel('品名').fill(name)
    await page.getByLabel('在庫個数').fill('0')
    await page.getByLabel('買い物リスト追加閾値').fill('1')
    await page.getByRole('button', { name: '保存' }).click()

    const inventoryRow = page.getByTestId('inventory-panel').getByRole('row').filter({ hasText: name })
    const quantity = inventoryRow.locator('.qty-value')
    await expect(quantity).toHaveText('0.0')

    const tabs = page.getByRole('navigation', { name: '在庫管理関連機能' })
    await tabs.getByRole('link', { name: '買い物リスト' }).click()
    await expect(page).toHaveURL(/\/zaiko\/shopping$/)

    const shopping = page.getByTestId('shopping-panel')
    const shoppingRow = shopping.getByRole('row').filter({ hasText: name })
    await expect(shoppingRow).toBeVisible()

    await shoppingRow.getByRole('button', { name: `${name}の購入個数を増やす` }).click()
    await shopping.getByRole('button', { name: '更新' }).click()
    await expect(shoppingRow).toHaveCount(0)

    await tabs.getByRole('link', { name: '在庫一覧' }).click()
    await expect(quantity).toHaveText('1.0')
  })

  for (const width of [1280, 390, 320]) {
    test(`在庫の縦操作・閾値連携・ページ幅（${width}px）`, async ({ browser, baseURL, consoleGuard }) => {
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
        for (const [path, name] of [['zaiko-categories', categoryName], ['stores', storeName]]) {
          const response = await page.request.post(`/api/${path}`, { headers, data: { name } })
          expect(response.status()).toBe(201)
        }
        await page.goto('/zaiko')
        const name = '[E2E_TEST]' + '長い品名'.repeat(10)
        await page.getByRole('button', { name: '在庫を登録' }).click()
        await page.getByLabel('品名', { exact: true }).fill(name)
        await page.getByLabel('カテゴリー', { exact: true }).selectOption({ label: categoryName })
        await page.locator('#inv-store').selectOption({ label: storeName })
        await page.getByLabel('在庫個数', { exact: true }).fill('1')
        await page.getByLabel('買い物リスト追加閾値').fill('1')
        await page.getByRole('button', { name: '保存', exact: true }).click()
        const row = page.getByTestId('inventory-panel').getByRole('row').filter({ hasText: name })
        const quantity = row.locator('.qty-value')
        await expect(quantity).toHaveText('1.0')
        await expect(row).toContainText(categoryName)
        await expect(row).toContainText(storeName)
        const plus = row.getByRole('button', { name: `${name}を増やす`, exact: true })
        const minus = row.getByRole('button', { name: `${name}を減らす`, exact: true })
        const step = row.getByRole('combobox')
        await plus.scrollIntoViewIfNeeded()
        const boxes = await Promise.all([plus, quantity, minus, step].map((locator) => locator.boundingBox()))
        for (const box of [boxes[0], boxes[2]]) {
          expect(box!.width).toBeGreaterThanOrEqual(40)
          expect(box!.height).toBeGreaterThanOrEqual(40)
        }
        for (let i = 0; i < boxes.length - 1; i++) {
          expect(boxes[i]!.y + boxes[i]!.height).toBeLessThanOrEqual(boxes[i + 1]!.y)
        }
        expect(boxes[0]!.x).toBe(boxes[2]!.x)
        const press = async (locator: typeof plus) => width < 400 ? locator.tap() : locator.click()
        await press(plus)
        await expect(quantity).toHaveText('2.0')
        await press(minus)
        await expect(quantity).toHaveText('1.0')
        await step.selectOption('0.1')
        await press(plus)
        await expect(quantity).toHaveText('1.1')
        await press(minus)
        await expect(quantity).toHaveText('1.0')
        await step.selectOption('1')
        await press(minus)
        await expect(quantity).toHaveText('0.0')
        let patches = 0
        page.on('request', (request) => { if (request.method() === 'PATCH') patches++ })
        await press(minus)
        await expect(page.getByText('在庫個数は0未満にできません')).toBeVisible()
        await expect(quantity).toHaveText('0.0')
        expect(patches).toBe(0)
        const tabs = page.getByRole('navigation', { name: '在庫管理関連機能' })
        await tabs.getByRole('link', { name: '買い物リスト' }).click()
        const shoppingRow = page.getByTestId('shopping-panel').getByRole('row').filter({ hasText: name })
        await expect(shoppingRow).toBeVisible()
        await tabs.getByRole('link', { name: '在庫一覧' }).click()
        await press(plus)
        await expect(quantity).toHaveText('1.0')
        await tabs.getByRole('link', { name: '買い物リスト' }).click()
        await expect(shoppingRow).toHaveCount(0)
        await tabs.getByRole('link', { name: '在庫一覧' }).click()
        await page.reload()
        await expect(quantity).toHaveText('1.0')
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
        const scroll = page.getByRole('region', { name: '在庫一覧（横スクロール可能）' })
        if (width < 400) {
          expect(await scroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
          await scroll.evaluate((element) => { element.scrollLeft = element.scrollWidth })
          await expect(plus).toBeInViewport()
          await expect(minus).toBeInViewport()
        }
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

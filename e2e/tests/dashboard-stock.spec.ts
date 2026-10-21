import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

for (const width of [1280, 390, 320]) {
  test(`買い物・在庫カードの値段・残数と折り返し ${width}px`, async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 })
    await setupUserWithHousehold(page, `dashboard_stock_${width}`)
    await page.goto('/zaiko')
    const items = [
      { name: '[E2E_TEST]' + '長'.repeat(40), price: '1280', quantity: '0', threshold: '1', want: '1,280円' },
      { name: '[E2E_TEST]' + 'A'.repeat(40), price: '9999999999', quantity: '0.5', threshold: '1', want: '9,999,999,999円' },
      { name: '[E2E_TEST] 無料', price: '0', quantity: '2', threshold: '3', want: '0円' },
      { name: '[E2E_TEST] 未設定', price: '', quantity: '0', threshold: '1', want: '未設定' },
      { name: '[E2E_TEST] 閾値と同じ', price: '777', quantity: '2', threshold: '2', want: '777円' },
    ]
    for (const item of items) {
      await page.getByRole('button', { name: '在庫を登録' }).click()
      await page.getByLabel('品名', { exact: true }).fill(item.name)
      await page.getByLabel('在庫個数', { exact: true }).fill(item.quantity)
      await page.getByLabel('買い物リスト追加閾値').fill(item.threshold)
      await page.getByLabel('値段（円・任意）').fill(item.price)
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect(page.getByTestId('inventory-panel').getByRole('button', { name: `${item.name}の詳細`, exact: true })).toBeVisible()
    }
    await page.goto('/')
    const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: '買い物・在庫', exact: true }) })
    const shopping = card.getByRole('list', { name: '買い物リスト' })
    const inventory = card.getByRole('list', { name: '在庫リスト' })
    for (const item of items) {
      const stockRow = inventory.getByRole('listitem').filter({ hasText: item.name })
      await expect(stockRow.locator('.dashboard-stock-name')).toHaveText(item.name)
      await expect(stockRow.locator('.dashboard-stock-value')).toHaveText(`残${item.quantity}${Number(item.quantity) <= Number(item.threshold) ? '（不足）' : ''}`)
      const shoppingRow = shopping.getByRole('listitem').filter({ hasText: item.name })
      if (Number(item.quantity) <= Number(item.threshold)) {
        await expect(shoppingRow.locator('.dashboard-stock-value')).toHaveText(item.want)
      } else await expect(shoppingRow).toHaveCount(0)
    }
    await expect(card.getByRole('link')).toHaveCount(0)
    await expect(card.getByText('値段', { exact: true })).toBeVisible()
    await expect(card.getByText('残数', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    for (const row of await card.getByRole('listitem').all()) {
      expect(await row.evaluate((element) => {
        const cardBounds = element.closest('.card')!.getBoundingClientRect()
        return [element, ...element.children].every((cell) => {
          const bounds = cell.getBoundingClientRect()
          const style = getComputedStyle(cell)
          return bounds.left >= cardBounds.left && bounds.right <= cardBounds.right && cell.scrollWidth <= cell.clientWidth && style.overflowX !== 'hidden' && style.textOverflow !== 'ellipsis'
        })
      })).toBe(true)
    }
    expect(await page.locator('.dashboard-summary-grid').evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length)).toBe(width === 1280 ? 2 : 1)
    await card.scrollIntoViewIfNeeded()
    const nav = page.getByRole('navigation', { name: '主要機能' })
    if (width < 800) {
      // 長いカードは画面より高いため、末尾を表示して固定ナビに隠れないことを確認する。
      await card.evaluate((element) => {
        const navTop = document.querySelector('.primary-nav')!.getBoundingClientRect().top
        window.scrollBy(0, element.getBoundingClientRect().bottom - navTop + 8)
      })
      const cardBounds = await card.boundingBox()
      const navBounds = await nav.boundingBox()
      expect(cardBounds).not.toBeNull()
      expect(navBounds).not.toBeNull()
      expect(cardBounds!.y + cardBounds!.height).toBeLessThanOrEqual(navBounds!.y)
    }
    const shots = process.env.DASHBOARD_STOCK_SCREENSHOT_DIR
    if (shots) {
      await mkdir(shots, { recursive: true })
      await page.screenshot({ path: join(shots, `dashboard-bottom-${width}.png`) })
      await page.screenshot({ path: join(shots, `dashboard-${width}.png`), fullPage: true })
      // 要素全体の撮影時だけ固定ナビを隠す。実表示の重なりは直前の座標検証とviewport画像で確認する。
      await card.screenshot({ path: join(shots, `stock-${width}.png`), style: '.primary-nav { visibility: hidden; }' })
    }
    await page.goto('/zaiko')
    await page.getByTestId('inventory-panel').getByRole('button', { name: `${items[0].name}の詳細`, exact: true }).click()
    const detail = page.getByRole('dialog', { name: '在庫詳細・編集' })
    await page.getByLabel('値段（円・任意）').fill('980')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(detail).toBeHidden()
    await page.goto('/')
    await expect(shopping.getByRole('listitem').filter({ hasText: items[0].name }).locator('.dashboard-stock-value')).toHaveText('980円')
  })
}


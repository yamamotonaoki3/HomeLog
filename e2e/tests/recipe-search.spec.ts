import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

for (const width of [1280, 390, 320]) {
  test(`検索入力直後の候補表示・選択追加・在庫と買い物の操作統一 ${width}px (#376)`, async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await page.setViewportSize({ width, height: 844 })
    await setupUserWithHousehold(page, `live_search_${width}`)
    const headers = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('homelog.accessToken'))}` }
    const titles = ['[E2E_TEST] からあげ', '[E2E_TEST] カレー', '[E2E_TEST] Pasta', '[E2E_TEST] ' + '長いタイトル'.repeat(12)]
    for (const title of [...titles, ...Array.from({ length: 8 }, (_, i) => `[E2E_TEST] レシピ${i}`)]) {
      const response = await page.request.post('/api/recipes', { headers, data: { title, sourceType: 'manual' } })
      expect(response.status()).toBe(201)
    }
    await page.goto('/menu')
    const menu = page.getByTestId('menu-panel')
    const search = menu.getByRole('searchbox', { name: 'レシピを検索' })
    const candidates = menu.getByRole('group', { name: 'レシピ候補' })
    const radios = candidates.getByRole('radio')
    await expect(radios).toHaveCount(12)
    expect(await candidates.locator('.menu-recipe-results').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
    await search.fill('カラアゲ')
    await expect(radios).toHaveCount(1)
    const first = candidates.getByRole('radio', { name: titles[0], exact: true })
    await expect(first).toBeVisible()
    await search.press('Tab')
    await expect(first).toBeFocused()
    await first.press('Space')
    await expect(first).toBeChecked()
    await expect(menu.getByText('この週の献立はまだありません')).toBeVisible()
    await search.fill('ＰＡＳＴＡ')
    await expect(radios).toHaveCount(1)
    await expect(candidates.getByRole('radio', { name: titles[2], exact: true })).toBeVisible()
    await search.fill('該当なし')
    await expect(radios).toHaveCount(0)
    await expect(candidates.getByRole('status')).toHaveText('該当するレシピがありません')
    await search.fill('')
    await expect(radios).toHaveCount(12)
    await expect(first).not.toBeChecked()
    const long = candidates.getByRole('radio', { name: titles[3], exact: true })
    await long.check()
    await expect(long).toBeChecked()
    await expect(menu.getByText('この週の献立はまだありません')).toBeVisible()
    expect(await candidates.locator('.menu-recipe-results').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    if (process.env.RECIPE_SEARCH_SCREENSHOT_DIR) {
      await mkdir(process.env.RECIPE_SEARCH_SCREENSHOT_DIR, { recursive: true })
      await page.screenshot({ path: join(process.env.RECIPE_SEARCH_SCREENSHOT_DIR, `recipe-search-${width}.png`), fullPage: true })
    }
    await menu.getByRole('button', { name: '追加', exact: true }).click()
    await expect(menu.getByRole('listitem').filter({ hasText: titles[3] })).toBeVisible()

    // 既存の2検索も追加操作なしで結果が切り替わることを実データで確認する。
    const categoryResponse = await page.request.get('/api/zaiko-categories', { headers })
    expect(categoryResponse.ok()).toBe(true)
    const [category] = await categoryResponse.json()
    for (const name of ['[E2E_TEST] にんじん', '[E2E_TEST] 牛乳']) {
      expect((await page.request.post('/api/inventory-items', { headers, data: { name, categoryId: category.id, storeId: null, quantity: 0, threshold: 1 } })).status()).toBe(201)
    }
    for (const [path, panelId] of [['/zaiko', 'inventory-panel'], ['/zaiko/shopping', 'shopping-panel']]) {
      await page.goto(path)
      const panel = page.getByTestId(panelId)
      const rows = panel.getByRole('button', { name: /の詳細$/ })
      const input = panel.getByRole('searchbox', { name: 'キーワード検索' })
      await expect(rows).toHaveCount(2)
      await input.fill('ニンジン')
      await expect(rows).toHaveCount(1)
      await expect(rows.first()).toContainText('にんじん')
      await input.fill('該当なし')
      await expect(rows).toHaveCount(0)
      await expect(panel.getByText('該当する品目がありません')).toBeVisible()
      await input.fill('')
      await expect(rows).toHaveCount(2)
    }
  })
}

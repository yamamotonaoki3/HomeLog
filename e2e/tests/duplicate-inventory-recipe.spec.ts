import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

for (const width of [1280, 390, 320]) {
  test(`重複登録のエラーと入力をモーダル内に保持する ${width}px (#319)`, async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await page.setViewportSize({ width, height: 900 })
    consoleGuard.allow({ url: /\/api\/inventory-items$/, message: /Failed to load resource:.*409/ })
    consoleGuard.allow({ url: /\/api\/recipes\/from-url$/, message: /Failed to load resource:.*409/ })
    await setupUserWithHousehold(page, `duplicate_ui_${width}`)

    const assertFits = async () => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      for (const element of await page.locator('.modal, .modal [role="alert"]').all()) {
        const box = await element.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(width)
        expect(await element.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
      }
    }

    await page.goto('/zaiko')
    const name = '[E2E_TEST] 重複する牛乳'
    await page.getByRole('button', { name: '在庫を登録' }).click()
    await page.getByLabel('品名', { exact: true }).fill(name)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    const rows = page.locator('.inventory-list .list-row-button')
    await expect(rows).toHaveCount(1)
    await expect(rows).toHaveText(/重複する牛乳/)
    await page.getByRole('button', { name: '在庫を登録' }).click()
    const inventoryModal = page.getByRole('dialog', { name: '在庫を登録' })
    await inventoryModal.getByLabel('品名', { exact: true }).fill(name)
    await inventoryModal.getByLabel('値段（円・任意）').fill('123')
    const inventoryConflict = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/inventory-items' && response.request().method() === 'POST')
    await inventoryModal.getByRole('button', { name: '保存' }).click()
    expect((await inventoryConflict).status()).toBe(409)
    await expect(inventoryModal.getByRole('alert')).toHaveText('同じ品名の在庫が既に登録されています')
    await expect(inventoryModal.getByLabel('品名', { exact: true })).toHaveValue(name)
    await expect(inventoryModal.getByLabel('値段（円・任意）')).toHaveValue('123')
    await expect(inventoryModal.getByRole('button', { name: '保存' })).toBeEnabled()
    await expect(rows).toHaveCount(1)
    await assertFits()
    await inventoryModal.getByRole('button', { name: 'キャンセル' }).click()
    await page.reload()
    await expect(rows).toHaveCount(1)

    // 通常の作成APIはURLを受け付けないため、初回だけfrom-urlで外部取得する。
    // 再登録時は実Workersが外部取得より先に409を返すことを検証する。
    const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
    const headers = { Authorization: `Bearer ${token}` }
    const url = `https://example.com/?e2e=${encodeURIComponent(`[E2E_TEST] duplicate_${width}`)}`
    const created = await page.request.post('/api/recipes/from-url', {
      headers, data: { url, memo: '[E2E_TEST] 初回登録' },
    })
    expect(created.status()).toBe(201)
    await page.goto('/recipes')
    await expect(page.locator('.recipe-list-item')).toHaveCount(1)
    await page.getByRole('button', { name: 'レシピを登録' }).click()
    await page.getByRole('tab', { name: 'WEB' }).click()
    const recipeModal = page.locator('.modal').filter({ has: page.getByRole('heading', { name: 'レシピを登録' }) })
    await recipeModal.getByLabel('レシピURL').fill(url)
    await recipeModal.getByLabel('メモ').fill('[E2E_TEST] 保持するメモ')
    const recipeConflict = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/recipes/from-url' && response.request().method() === 'POST')
    await recipeModal.getByRole('button', { name: '登録', exact: true }).click()
    expect((await recipeConflict).status()).toBe(409)
    await expect(recipeModal.getByRole('alert')).toHaveText('このURLのレシピは既に登録されています')
    await expect(recipeModal.getByLabel('レシピURL')).toHaveValue(url)
    await expect(recipeModal.getByLabel('メモ')).toHaveValue('[E2E_TEST] 保持するメモ')
    await expect(recipeModal.getByRole('button', { name: '登録', exact: true })).toBeEnabled()
    await expect(page.locator('.recipe-list-item')).toHaveCount(1)
    await assertFits()
    const listed = await page.request.get('/api/recipes', { headers })
    expect(listed.status()).toBe(200)
    expect(await listed.json()).toHaveLength(1)
  })
}

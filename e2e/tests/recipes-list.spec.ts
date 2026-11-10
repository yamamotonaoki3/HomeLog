import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

// レシピ一覧(S-12)の見た目に関わる構成(#489)。1件1カード・星のお気に入り・登録案内。
for (const width of [1280, 390, 320]) {
  test(`レシピ一覧は1件を1枚のカードで表示し、長いタイトルでも横にはみ出さない ${width}px (#489)`, async ({ page, consoleGuard }) => {
    await page.setViewportSize({ width, height: 844 })
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, `recipes_list_${width}`)
    const headers = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('homelog.accessToken'))}` }
    const longTitle = '[E2E_TEST] ' + '長いレシピ名'.repeat(12)
    const shortTitle = '[E2E_TEST] 肉じゃが'
    const created: number[] = []
    for (const title of [longTitle, shortTitle]) {
      const response = await page.request.post('/api/recipes', { headers, data: { title, ingredients: '[E2E_TEST] 材料', steps: '[E2E_TEST] 手順' } })
      expect(response.status()).toBe(201)
      created.push((await response.json()).id)
    }
    expect((await page.request.patch(`/api/recipes/${created[1]}/favorite`, { headers, data: { isFavorite: true } })).ok()).toBe(true)

    await page.goto('/recipes')
    const panel = page.getByTestId('recipes-panel')
    await expect(panel.getByRole('heading', { level: 2, name: 'レシピ一覧', exact: true })).toBeVisible()
    await expect(panel.getByText('タイトルを押すと材料と手順を確認できます', { exact: true })).toBeVisible()
    await expect(panel.getByRole('heading', { level: 3, name: '登録済みのレシピ（2件）', exact: true })).toBeVisible()
    const items = panel.getByRole('list', { name: 'レシピ', exact: true }).getByRole('listitem')
    await expect(items).toHaveCount(2)

    const register = panel.getByRole('button', { name: 'レシピを登録', exact: true })
    const longRow = panel.getByRole('button', { name: longTitle, exact: true })
    const shortRow = panel.getByRole('button', { name: shortTitle, exact: true })
    const favoriteOn = panel.getByRole('button', { name: '★ お気に入り', exact: true })
    const favoriteOff = panel.getByRole('button', { name: '☆ お気に入りにする', exact: true })
    await expect(favoriteOn).toHaveCount(1)
    await expect(favoriteOff).toHaveCount(1)
    for (const control of [register, longRow, shortRow, favoriteOn, favoriteOff]) {
      const box = (await control.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
    }
    // お気に入りはタイトルの行と同じ段の右側に置く(狭い画面でも段を分けない)。
    const rowBox = (await shortRow.boundingBox())!
    const starBox = (await favoriteOn.boundingBox())!
    expect(starBox.x).toBeGreaterThanOrEqual(rowBox.x + rowBox.width - 1)
    expect(starBox.y).toBeGreaterThanOrEqual(rowBox.y - 1)
    expect(starBox.y + starBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    expect(await panel.locator('.recipe-title-button > span').evaluateAll(elements => elements.some(el => el.scrollWidth > el.clientWidth))).toBe(false)

    // 登録案内は同じ幅のカードで、一覧の下に並ぶ。
    const pc = panel.getByRole('region', { name: 'PCからレシピを登録', exact: true })
    const iphone = panel.getByRole('region', { name: 'iPhoneからレシピを登録', exact: true })
    await expect(panel.getByText('ほかの登録方法', { exact: true })).toBeVisible()
    await expect(pc).toBeVisible()
    await expect(iphone).toBeVisible()
    const [listBox, pcBox, iphoneBox] = await Promise.all([items.first().boundingBox(), pc.boundingBox(), iphone.boundingBox()])
    expect(Math.abs(pcBox!.width - listBox!.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(iphoneBox!.width - listBox!.width)).toBeLessThanOrEqual(1)
    expect((await iphone.getByRole('link', { name: 'ショートカットを追加する', exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44)

    if (process.env.RECIPES_SCREENSHOT_DIR) {
      await mkdir(process.env.RECIPES_SCREENSHOT_DIR, { recursive: true })
      await page.screenshot({ path: join(process.env.RECIPES_SCREENSHOT_DIR, `recipes-list-${width}.png`), fullPage: true })
    }

    // 「すべて／お気に入り」の切り替え(#495)。星を付けたレシピだけに絞り込める。
    const filter = panel.getByRole('group', { name: '表示するレシピ', exact: true })
    const all = filter.getByRole('radio', { name: 'すべて', exact: true })
    const favorites = filter.getByRole('radio', { name: 'お気に入り', exact: true })
    await expect(all).toBeChecked()
    for (const option of ['すべて', 'お気に入り']) {
      const box = (await filter.locator('label').filter({ hasText: option }).first().boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
    }
    await filter.locator('label').filter({ hasText: 'お気に入り' }).click()
    await expect(favorites).toBeChecked()
    await expect(panel.getByRole('heading', { level: 3, name: 'お気に入りのレシピ（1件）', exact: true })).toBeVisible()
    await expect(items).toHaveCount(1)
    await expect(shortRow).toBeVisible()
    await expect(longRow).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    if (process.env.RECIPES_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.RECIPES_SCREENSHOT_DIR, `recipes-favorites-${width}.png`), fullPage: true })
    // 表示中に星を外すと一覧から消え、0件の案内に変わる。フォーカスは切り替えに残る。
    await favoriteOn.click()
    await expect(panel.getByText('お気に入りのレシピはありません', { exact: true })).toBeVisible()
    await expect(items).toHaveCount(0)
    await expect(favorites).toBeFocused()
    await filter.locator('label').filter({ hasText: 'すべて' }).click()
    await expect(items).toHaveCount(2)
    await expect(favoriteOff).toHaveCount(2)
    // 元の状態(短いタイトルがお気に入り)へ戻す。
    await panel.getByRole('listitem').filter({ hasText: shortTitle }).getByRole('button', { name: '☆ お気に入りにする', exact: true }).click()
    await expect(favoriteOn).toHaveCount(1)

    // お気に入りの切り替えと、行の隅を押しても詳細が開くこと。
    await favoriteOff.click()
    await expect(panel.getByRole('button', { name: '★ お気に入り', exact: true })).toHaveCount(2)
    await longRow.click({ position: { x: 3, y: 3 } })
    const detail = page.getByRole('dialog', { name: 'レシピ詳細', exact: true })
    await expect(detail).toContainText('[E2E_TEST] 材料')
    await detail.getByRole('button', { name: '閉じる', exact: true }).click()
    await expect(detail).toHaveCount(0)
  })
}

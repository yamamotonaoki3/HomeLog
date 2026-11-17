import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

// WEBの保存済み値だけをAPI mockで与える。実from-url POST/外部取得/DB直書きは行わない。
for (const width of [1280, 390, 320]) {
  test(`保存済みレシピの画像と元リンクは本文・操作を保つ ${width}px (#570)`, async ({ page, context, baseURL, consoleGuard }) => {
    consoleGuard.watch(page)
    context.on('page', popup => consoleGuard.watch(popup))
    const origin = new URL(baseURL!).origin
    expect(new URL(origin).hostname).toBe('localhost')
    const goodImage = 'https://cdn.example.com/recipe-good.png?signature=a%2Fb&key=1'
    const brokenImage = 'https://cdn.example.com/recipe-broken.png'
    const source = 'http://recipe.example.com/a?q=%25&x=a%2Fb#steps'
    const common = { ingredients: null, steps: null, sourceType: 'web', memo: '[E2E_TEST] <em>そのままのメモ</em>', isFavorite: false }
    const recipes = [
      { ...common, id: 101, title: '[E2E_TEST] 正常画像と元ページ', url: source, thumbnailUrl: goodImage },
      { ...common, id: 102, title: '[E2E_TEST] 読込失敗でも残すタイトル' + '長い料理名'.repeat(10), url: 'https://recipe.example.com/broken?x=1#memo', thumbnailUrl: brokenImage },
      { ...common, id: 103, title: '[E2E_TEST] 画像なし', url: 'https://recipe.example.com/none', thumbnailUrl: null },
      { ...common, id: 104, title: '[E2E_TEST] <strong>不正な保存済みURL</strong>', url: 'javascript:0', thumbnailUrl: 'data:image/png;base64,a' },
    ]
    const unexpectedExternal: string[] = []
    // deny-by-default。予約domainの画像と元ページも全てローカルで応答し、popupにも適用する。
    await context.route('**/*', async route => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.url() === goodImage) {
        await route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY1sAAAAASUVORK5CYII=', 'base64') })
      } else if (request.url() === brokenImage) {
        await route.fulfill({ status: 404, contentType: 'text/plain', body: '[E2E_TEST] missing image' })
      } else if (url.origin === 'http://recipe.example.com' && url.pathname === '/a') {
        await route.fulfill({ contentType: 'text/plain', body: '[E2E_TEST] mock source page' })
      } else if (url.origin !== origin || url.pathname === '/api/recipes/from-url') {
        unexpectedExternal.push(request.url())
        await route.abort('blockedbyclient')
      } else if (url.pathname === '/api/recipes' && request.method() === 'GET') {
        await route.fulfill({ json: recipes })
      } else if (url.pathname === '/api/menu-entries' && request.method() === 'GET') {
        await route.fulfill({ json: recipes.map(recipe => ({ id: recipe.id, recipeId: recipe.id, recipeTitle: recipe.title, freeTextMemo: null, weekStartDate: url.searchParams.get('weekStartDate') })) })
      } else await route.continue()
    })
    consoleGuard.allow({ url: /^https:\/\/cdn\.example\.com\/recipe-broken\.png$/, message: /^Failed to load resource: the server responded with a status of 404/ })
    await page.setViewportSize({ width, height: 900 })
    await setupUserWithHousehold(page, `safe_recipe_${width}`)
    const fits = async () => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      expect(await page.locator('.modal').evaluateAll(elements => elements.some(el => el.scrollWidth > el.clientWidth))).toBe(false)
    }
    await page.goto('/recipes')
    const panel = page.getByTestId('recipes-panel')
    await expect(panel.locator('.recipe-list-item')).toHaveCount(4)
    await expect(panel.locator('.recipe-list-thumbnail')).toHaveCount(1)
    expect(await panel.locator('.recipe-list-thumbnail').evaluate(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true)
    await fits()
    await panel.getByRole('button', { name: recipes[0].title, exact: true }).click()
    const detail = page.getByRole('dialog', { name: 'レシピ詳細', exact: true })
    await expect(detail.getByRole('img')).toHaveAttribute('src', goodImage)
    const link = detail.getByRole('link', { name: '元ページを開く', exact: true })
    await expect(link).toHaveAttribute('href', source)
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    const popupPromise = context.waitForEvent('page')
    await link.click()
    const popup = await popupPromise
    await expect(popup.locator('body')).toHaveText('[E2E_TEST] mock source page')
    await popup.close()
    await detail.getByRole('button', { name: '閉じる', exact: true }).click()

    for (const recipe of recipes.slice(1)) {
      await panel.getByRole('button', { name: recipe.title, exact: true }).click()
      await expect(detail.getByRole('img')).toHaveCount(0)
      await expect(detail.getByRole('heading', { name: recipe.title, exact: true })).toBeVisible()
      await expect(detail.getByText(common.memo, { exact: true })).toBeVisible()
      await expect(detail.locator('em, strong')).toHaveCount(0)
      await expect(detail.getByRole('link', { name: '元ページを開く', exact: true })).toHaveCount(recipe.id === 104 ? 0 : 1)
      await fits()
      if (recipe.id === 102 && width === 390 && process.env.RECIPE_SAFE_SCREENSHOT_DIR) {
        await mkdir(process.env.RECIPE_SAFE_SCREENSHOT_DIR, { recursive: true })
        await page.screenshot({ path: join(process.env.RECIPE_SAFE_SCREENSHOT_DIR, 'recipe-safe-failed-390.png'), fullPage: true })
      }
      if (recipe.id === 102) {
        await detail.getByRole('button', { name: '編集', exact: true }).click()
        const edit = page.locator('.modal').filter({ has: page.getByRole('heading', { name: 'WEBレシピを編集', exact: true }) })
        await expect(edit.locator('img')).toHaveCount(0)
        await expect(edit.getByLabel('メモ', { exact: true })).toHaveValue(common.memo)
        await expect(edit.getByRole('link', { name: '元ページを開く', exact: true })).toHaveAttribute('href', recipe.url)
        await expect(edit.getByRole('button', { name: '更新', exact: true })).toBeEnabled()
        await edit.getByRole('button', { name: 'キャンセル', exact: true }).click()
      } else await detail.getByRole('button', { name: '閉じる', exact: true }).click()
    }

    await page.goto('/menu')
    const menu = page.getByTestId('menu-panel')
    await menu.getByRole('button', { name: recipes[0].title, exact: true }).click()
    await expect(menu.getByRole('link', { name: 'レシピを見る', exact: true })).toHaveAttribute('href', source)
    await expect(menu.getByRole('link', { name: 'レシピを見る', exact: true })).toHaveAttribute('rel', 'noopener noreferrer')
    await menu.getByRole('button', { name: recipes[0].title, exact: true }).click()
    await menu.getByRole('button', { name: recipes[3].title, exact: true }).click()
    await expect(menu.getByRole('link', { name: 'レシピを見る', exact: true })).toHaveCount(0)
    await expect(menu.getByRole('button', { name: '削除', exact: true })).toBeVisible()
    await menu.getByRole('button', { name: 'レシピを見る', exact: true }).click()
    await expect(detail.getByText(common.memo, { exact: true })).toBeVisible()
    await expect(detail.getByRole('link')).toHaveCount(0)
    await fits()
    expect(unexpectedExternal).toEqual([])
  })
}

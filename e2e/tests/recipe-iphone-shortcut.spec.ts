import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

const viewedUrl = 'https://recipe.example.com/料理?q=a&eq=x=y&plus=+&pct=%25#手順'

async function layout(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  for (const element of await page.locator('.recipe-iphone-guide h2, .recipe-iphone-guide h3, .recipe-iphone-guide input, .recipe-iphone-guide .btn').all()) {
    const box = await element.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  }
}

for (const width of [1280, 390, 320]) {
  test(`${width}px: iPhone案内・コピー・共有契約・戻る`, async ({ page, context, consoleGuard }) => {
    consoleGuard.watch(page)
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 })
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async (text: string) => { document.documentElement.dataset.copied = text },
      } })
    })
    await setupUserWithHousehold(page, `iphone${width}`)
    await page.goto('/recipes')
    const pc = page.locator('.recipe-bookmarklet-guide')
    const iphone = page.locator('.recipe-iphone-guide')
    await expect(iphone).toBeVisible()
    const a = (await pc.boundingBox())!
    const b = (await iphone.boundingBox())!
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height)
    expect(b.x).toBe(a.x)
    expect(b.width).toBe(a.width)
    await layout(page)
    const dir = process.env.RECIPE_IPHONE_SCREENSHOT_DIR
    if (dir) {
      await mkdir(dir, { recursive: true })
      await page.getByRole('link', { name: 'ショートカットの作り方' }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(dir, `recipes-${width}.png`), fullPage: true })
    }
    const posts: unknown[] = []
    const recipes: unknown[] = []
    await context.route('**/api/recipes', (route) => route.fulfill({ json: recipes }))
    await context.route('**/api/recipes/from-url', async (route) => {
      const body = route.request().postDataJSON()
      posts.push(body)
      const recipe = { id: 998, title: '[E2E_TEST] iPhoneレシピ', sourceType: 'web', url: body.url, memo: null, ingredients: null, steps: null, thumbnailUrl: null, isFavorite: false }
      recipes.push(recipe)
      await route.fulfill({ status: 201, json: recipe })
    })
    await page.getByRole('link', { name: 'ショートカットの作り方' }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/recipes\/iphone-shortcut$/)
    const input = page.getByLabel('登録先URLの接頭辞')
    const prefix = `${new URL(page.url()).origin}/recipes/share?url=`
    await expect(input).toHaveValue(prefix)
    await page.getByRole('button', { name: 'URLをコピー' }).click()
    await expect(page.getByRole('status')).toContainText('コピーしました')
    expect(await page.locator('html').getAttribute('data-copied')).toBe(prefix)
    await layout(page)
    await page.getByRole('link', { name: 'レシピ一覧に戻る' }).scrollIntoViewIfNeeded()
    if (dir) await page.screenshot({ path: join(dir, `iphone-shortcut-${width}.png`), fullPage: true })
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }))
    await page.getByRole('button', { name: 'URLをコピー' }).click()
    await expect(page.getByRole('status')).toContainText('手動でコピー')
    await input.focus()
    expect(await input.evaluate((element: HTMLInputElement) => element.selectionEnd! - element.selectionStart!)).toBe(prefix.length)
    expect(posts).toEqual([])
    await page.getByRole('link', { name: 'レシピ一覧に戻る' }).click()
    await expect(page).toHaveURL(/\/recipes$/)
    await page.goto(prefix + encodeURIComponent(viewedUrl))
    await expect(page.getByLabel('レシピURL')).toHaveValue(viewedUrl)
    await expect(page.getByRole('tab', { name: 'WEB', selected: true })).toBeVisible()
    expect(posts).toEqual([])
    await page.getByRole('button', { name: 'キャンセル' }).click()
    expect(posts).toEqual([])
    await page.goto(prefix + encodeURIComponent(viewedUrl))
    await page.getByRole('button', { name: '登録', exact: true }).click()
    await expect(page.getByRole('button', { name: '[E2E_TEST] iPhoneレシピ' })).toBeVisible()
    expect(posts).toEqual([{ url: viewedUrl, memo: null }])
  })
}

test('案内は未ログインならログインへ、世帯未所属なら世帯画面へ遷移する', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  await page.goto('/recipes/iphone-shortcut')
  await expect(page).toHaveURL(/\/login$/)
  await setupUserWithHousehold(page, 'iphoneGuard')
  await page.route('**/api/households/me', (route) => route.fulfill({ status: 404, json: { message: 'not found' } }))
  consoleGuard.allow({ url: /\/api\/households\/me$/, message: /404 \(Not Found\)/ })
  await page.goto('/recipes/iphone-shortcut')
  await expect(page).toHaveURL(/\/household$/)
})

test('コピーした接頭辞で共有し、未ログインの失敗・再試行後もURLを保持する', async ({ page, browser, consoleGuard }) => {
  consoleGuard.watch(page)
  const user = await setupUserWithHousehold(page, 'iphoneLogin')
  await page.goto('/recipes/iphone-shortcut')
  const prefix = await page.getByLabel('登録先URLの接頭辞').inputValue()
  const context = await browser.newContext()
  try {
    const shared = await context.newPage()
    consoleGuard.watch(shared)
    await shared.goto(prefix + encodeURIComponent(viewedUrl))
    await expect(shared).toHaveURL(/\/login$/)
    consoleGuard.allow({ url: /\/api\/auth\/login$/, message: /401 \(Unauthorized\)/ })
    await shared.getByLabel('メールアドレス').fill(user.email)
    await shared.locator('#login-password').fill('WrongTestPass123!')
    await shared.getByRole('button', { name: 'ログイン', exact: true }).click()
    await expect(shared.locator('.error')).not.toBeEmpty()
    await shared.locator('#login-password').fill(user.password)
    await shared.getByRole('button', { name: 'ログイン', exact: true }).click()
    await expect(shared.getByLabel('レシピURL')).toHaveValue(viewedUrl)
    await expect(shared.getByRole('tab', { name: 'WEB', selected: true })).toBeVisible()
  } finally {
    await context.close()
  }
})

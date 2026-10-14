import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserContext, Locator, Page } from '@playwright/test'
import { expect, test, type ConsoleGuard } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

const VIEWED_URL = 'https://recipe.example.com/料理?q=a&eq=x=y&plus=+&pct=%25&quote=%22%27#手順'

async function assertLayout(page: Page, elements: Locator[]) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  const { width, height } = page.viewportSize()!
  const boxes = []
  for (const element of elements) {
    await expect(element).toBeVisible()
    const box = await element.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(height)
    boxes.push(box!)
  }
  for (let i = 0; i < boxes.length; i++) {
    for (const b of boxes.slice(i + 1)) {
      const a = boxes[i]
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
    }
  }
}

async function shot(page: Page, name: string, project: string) {
  const dir = process.env.RECIPE_BOOKMARKLET_SCREENSHOT_DIR
  if (!dir) return
  await mkdir(dir, { recursive: true })
  await page.screenshot({ path: join(dir, `${project}-${name}.png`), fullPage: true })
}

// アプリDOMから取り出した実際のコードを別originのページでユーザークリックから実行。
// noopenerでpopupイベントへ依存せず、contextで新規タブを取得して直ちに監視する。
async function launch(context: BrowserContext, href: string, guard: ConsoleGuard) {
  const source = await context.newPage()
  guard.watch(source)
  await context.route('https://recipe.example.com/**', (route) => route.fulfill({
    contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>[E2E_TEST] 閲覧ページ</title><button id="run">[E2E_TEST] 登録</button>',
  }))
  await source.goto(VIEWED_URL)
  const original = source.url()
  await source.evaluate((code) => {
    document.querySelector('#run')!.addEventListener('click', () => {
      // ブックマークレット本体の評価。ユーザークリックと同期する。
      new Function(code.slice('javascript:'.length))()
    })
  }, href)
  context.once('page', (page) => guard.watch(page))
  const opened = context.waitForEvent('page')
  await source.getByRole('button', { name: '[E2E_TEST] 登録' }).click()
  const shared = await opened
  await shared.waitForLoadState('domcontentloaded')
  expect(source.url()).toBe(original)
  await expect(source.getByRole('button')).toBeVisible()
  expect(await shared.evaluate(() => window.opener)).toBeNull()
  return { source, shared, original }
}

for (const width of [1280, 390, 320]) {
  test(`${width}px: 閲覧ページから別タブでWEB登録、明示操作で保存`, async ({ page, context, consoleGuard }, info) => {
    consoleGuard.watch(page)
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 })
    await setupUserWithHousehold(page, `bookmark${width}`)
    await page.goto('/recipes')
    const link = page.getByRole('link', { name: 'HomeLogに登録' })
    await expect(link).toBeVisible()
    await assertLayout(page, [page.getByRole('heading', { name: 'PCからレシピを登録' }), link, page.locator('.recipe-bookmarklet-guide ol')])
    await shot(page, `guide-${width}`, info.project.name)
    const href = (await link.getAttribute('href'))!
    expect(href).toMatch(/^javascript:void\(/)
    await link.click()
    await expect(page.getByRole('status')).toContainText('ブックマークバー')
    await expect(page).toHaveURL(/\/recipes$/)

    const recipes: unknown[] = []
    const posts: unknown[] = []
    await context.route('**/api/recipes', (route) => route.fulfill({ json: recipes }))
    await context.route('**/api/recipes/from-url', async (route) => {
      const body = route.request().postDataJSON()
      posts.push(body)
      const recipe = { id: 999, title: '[E2E_TEST] WEBレシピ', sourceType: 'web', url: body.url, memo: body.memo, ingredients: null, steps: null, thumbnailUrl: null, isFavorite: false }
      recipes.push(recipe)
      await route.fulfill({ status: 201, json: recipe })
    })
    const { shared, original } = await launch(context, href, consoleGuard)
    await shared.setViewportSize({ width, height: width === 1280 ? 800 : 844 })
    await expect(shared.getByLabel('レシピURL')).toHaveValue(original)
    const destination = new URL(shared.url())
    expect(destination.origin).toBe(new URL(page.url()).origin)
    expect(destination.pathname).toBe('/recipes/share')
    expect(destination.searchParams.get('url')).toBe(original)
    await expect(shared.getByRole('tab', { name: 'WEB', selected: true })).toBeVisible()
    expect(posts).toEqual([])
    await assertLayout(shared, [shared.getByLabel('レシピURL'), shared.getByRole('button', { name: '登録', exact: true }), shared.getByRole('button', { name: 'キャンセル' })])
    await shot(shared, `share-${width}`, info.project.name)
    await shared.getByLabel('メモ').fill('[E2E_TEST] 独自メモ')
    await shared.getByRole('button', { name: '登録', exact: true }).click()
    await expect(shared.getByRole('button', { name: '[E2E_TEST] WEBレシピ' })).toBeVisible()
    expect(posts).toEqual([{ url: original, memo: '[E2E_TEST] 独自メモ' }])
    // キャンセル操作も保存を発生させない。
    await shared.goto(destination.toString())
    await expect(shared.getByLabel('レシピURL')).toHaveValue(original)
    await shared.getByRole('button', { name: 'キャンセル' }).click()
    await expect(shared.getByLabel('レシピURL')).toHaveCount(0)
    expect(posts).toHaveLength(1)
  })

  test(`${width}px: 未ログインから失敗・再試行を経て共有URLへ復帰`, async ({ page, browser, consoleGuard }) => {
    consoleGuard.watch(page)
    const user = await setupUserWithHousehold(page, `bookmarkLogin${width}`)
    await page.goto('/recipes')
    const href = (await page.getByRole('link', { name: 'HomeLogに登録' }).getAttribute('href'))!
    const context = await browser.newContext({ viewport: { width, height: width === 1280 ? 800 : 844 }, timezoneId: 'Asia/Tokyo' })
    try {
      const { shared, original } = await launch(context, href, consoleGuard)
      await expect(shared).toHaveURL(/\/login$/)
      consoleGuard.allow({ url: /\/api\/auth\/login$/, message: /401 \(Unauthorized\)/ })
      await shared.getByLabel('メールアドレス').fill(user.email)
      await shared.locator('#login-password').fill('WrongTestPass123!')
      await shared.getByRole('button', { name: 'ログイン', exact: true }).click()
      await expect(shared.locator('.error')).not.toBeEmpty()
      await expect(shared).toHaveURL(/\/login$/)
      await shared.locator('#login-password').fill(user.password)
      await shared.getByRole('button', { name: 'ログイン', exact: true }).click()
      await expect(shared.getByLabel('レシピURL')).toHaveValue(original)
      expect(new URL(shared.url()).pathname).toBe('/recipes/share')
      expect(new URL(shared.url()).searchParams.get('url')).toBe(original)
      await expect(shared.getByRole('tab', { name: 'WEB', selected: true })).toBeVisible()
    } finally {
      await context.close()
    }
  })
}

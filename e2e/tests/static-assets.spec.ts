import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

for (const width of [1280, 390, 320]) {
  test.describe(`Workers静的配信 ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 1280 })
    test('SPA直接アクセス・再読込・同一origin API・共有復帰', async ({ page, context, request, consoleGuard }) => {
      consoleGuard.watch(page)
      const response = await page.goto('/login')
      expect(response!.status()).toBe(200)
      await expect(page.getByLabel('メールアドレス')).toBeVisible()
      const shot = async (name: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
        const dir = process.env.STATIC_ASSETS_SCREENSHOT_DIR
        if (dir) {
          await mkdir(dir, { recursive: true })
          await page.screenshot({ path: join(dir, `${name}-${width}.png`), fullPage: true })
        }
      }
      await shot('login')
      const assets = await page.locator('script[src], link[rel="stylesheet"]').evaluateAll((els) => els.map((el) => el.getAttribute('src') ?? el.getAttribute('href')!))
      expect(assets.some((url) => url.endsWith('.js'))).toBe(true)
      expect(assets.some((url) => url.endsWith('.css'))).toBe(true)
      for (const url of [...assets, '/favicon.svg', '/manifest.webmanifest', '/sw.js']) {
        const res = await request.get(url)
        expect(res.status()).toBe(200)
        expect(res.headers()['content-type']).toMatch(url.endsWith('.css') ? /text\/css/ : url.endsWith('.svg') ? /image\/svg/ : url.endsWith('.webmanifest') ? /json|manifest/ : /javascript/)
      }
      for (const headers of [{}, { 'Sec-Fetch-Mode': 'navigate', Accept: 'text/html' }]) {
        const health = await request.get('/health', { headers })
        expect(health.status()).toBe(200)
        expect(await health.json()).toEqual({ status: 'ok' })
        const me = await request.get('/api/auth/me', { headers })
        expect(me.status()).toBe(401)
        expect(me.headers()['content-type']).toContain('application/json')
        for (const path of ['/api', '/api/not-found']) {
          const missing = await request.get(path, { headers })
          expect(missing.status()).toBe(404)
          expect(missing.headers()['content-type']).not.toContain('text/html')
        }
      }
      expect((await page.goto('/'))!.status()).toBe(200)
      await expect(page).toHaveURL(/\/login$/)
      const user = await setupUserWithHousehold(page, `static${width}`)
      await page.goto('/')
      await page.reload()
      await expect(page.getByRole('button', { name: 'ログアウト' })).toBeVisible()
      await expect(page.getByText('口座残高合計: 0円', { exact: true })).toBeVisible()
      await shot('dashboard')
      const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
      const me = await request.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      expect(me.status()).toBe(200)
      expect(await me.json()).toMatchObject({ displayName: user.displayName })
      await page.goto('/recipes/iphone-shortcut')
      await page.reload()
      const prefix = page.getByLabel('登録先URLの接頭辞')
      await expect(prefix).toHaveValue('http://localhost:8787/recipes/share?url=')
      await prefix.focus()
      await expect(prefix).toBeFocused()
      await page.getByRole('link', { name: 'レシピ一覧に戻る' }).scrollIntoViewIfNeeded()
      await shot('iphone-shortcut')
      const sharedUrl = 'https://recipe.example.com/料理?q=a&eq=x=y&plus=+&pct=%25#手順'
      const shared = `/recipes/share?url=${encodeURIComponent(sharedUrl)}#return`
      await context.clearCookies()
      await page.evaluate(() => localStorage.clear())
      let saves = 0
      page.on('request', (req) => { if (req.method() === 'POST' && req.url().endsWith('/api/recipes/from-url')) saves++ })
      await page.goto(shared)
      await expect(page).toHaveURL(/\/login$/)
      await page.getByLabel('メールアドレス').fill(user.email)
      await page.locator('#login-password').fill(user.password)
      await page.getByRole('button', { name: 'ログイン', exact: true }).click()
      await expect(page.getByLabel('レシピURL')).toHaveValue(sharedUrl)
      await expect(page.getByRole('tab', { name: 'WEB', selected: true })).toBeVisible()
      expect(new URL(page.url()).hash).toBe('#return')
      expect(saves).toBe(0)
    })
  })
}

test('Service Worker登録後もオンラインAPIと深部URLが動く', async ({ browser, consoleGuard }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:8787', serviceWorkers: 'allow' })
  try {
    const page = await context.newPage()
    consoleGuard.watch(page)
    consoleGuard.allow({ url: /\/api\/auth\/me$/, message: /401 \(Unauthorized\)/ })
    consoleGuard.allow({ url: /\/api(?:\/not-found)?(?:\?probe=1)?$/, message: /404 \(Not Found\)/ })
    await setupUserWithHousehold(page, 'staticPwa')
    await page.evaluate(async () => { await navigator.serviceWorker.ready })
    await page.reload()
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
    const responses = await page.evaluate(async () => {
      return Promise.all(['/health', '/api/auth/me', '/api', '/api/not-found'].map(async (url) => {
        const res = await fetch(url)
        return { status: res.status, type: res.headers.get('content-type'), body: await res.text() }
      }))
    })
    expect(responses.map((res) => res.status)).toEqual([200, 401, 404, 404])
    expect(responses[1].type).toContain('application/json')
    expect(responses.every((res) => !res.type?.includes('text/html'))).toBe(true)
    for (const [path, status] of [['/health', 200], ['/api/auth/me', 401], ['/api', 404], ['/api/not-found', 404], ['/health?probe=1', 200], ['/api?probe=1', 404]] as const) {
      const response = await page.goto(path)
      expect(response!.status()).toBe(status)
      expect(response!.headers()['content-type']).not.toContain('text/html')
    }
    await page.goto('/recipes/share?url=https%3A%2F%2Frecipe.example.com%2Fpwa')
    await expect(page.getByLabel('レシピURL')).toHaveValue('https://recipe.example.com/pwa')
  } finally {
    await context.close()
  }
})

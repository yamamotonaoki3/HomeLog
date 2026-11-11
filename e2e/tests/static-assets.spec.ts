import { openAccountMenu } from './support/flows'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

test('公開HTMLは検索結果への掲載を禁止する (#386)', async ({ page, request, consoleGuard }) => {
  consoleGuard.watch(page)
  await page.goto('/login')
  for (const path of ['/', '/login', '/register', '/recipes/iphone-shortcut', '/menu']) {
    const response = await request.get(path)
    expect(response.status()).toBe(200)
    const html = await response.text()
    // JavaScript実行後ではなく、クローラーに返す元HTMLに含まれることを確認する。
    const directive = await page.evaluate((source) => new DOMParser()
      .parseFromString(source, 'text/html')
      .querySelector('meta[name="robots"]')?.getAttribute('content'), html)
    expect(directive?.toLowerCase().split(/[\s,]+/)).toContain('noindex')
  }
})

test('選定済みアイコンをファビコン・iOS・PWAへ配信する (#384)', async ({ page, request, consoleGuard }) => {
  consoleGuard.watch(page)
  await page.goto('/login')
  await expect(page).toHaveTitle('シェファミ')
  await expect(page.getByRole('heading', { name: 'シェファミ', exact: true })).toBeVisible()
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png')
  await expect(page.locator('link[rel="icon"][type="image/x-icon"]')).toHaveAttribute('href', '/favicon.ico')
  const response = await request.get('/manifest.webmanifest')
  expect(response.ok()).toBe(true)
  const manifest = await response.json()
  expect(manifest.name).toBe('シェファミ')
  expect(manifest.short_name).toBe('シェファミ')
  expect(manifest.icons).toEqual(expect.arrayContaining([
    { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ]))
  for (const [url, size] of [['/apple-touch-icon.png', 180], ['/pwa-192.png', 192], ['/pwa-512.png', 512], ['/maskable-512.png', 512]] as const) {
    const image = await request.get(url)
    expect(image.status()).toBe(200)
    expect(image.headers()['content-type']).toMatch(/image\/png/)
    const dimensions = await page.evaluate(async (src) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let opaque = true
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 255) opaque = false
      return { size: [img.naturalWidth, img.naturalHeight], opaque }
    }, url)
    expect(dimensions).toEqual({ size: [size, size], opaque: true })
  }
  const favicon = await request.get('/favicon.ico')
  expect(favicon.status()).toBe(200)
  expect(favicon.headers()['content-type']).toMatch(/image\/(?:x-icon|vnd.microsoft.icon)/)
})

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
      await expect((await openAccountMenu(page)).getByRole('button', { name: 'ログアウト', exact: true })).toBeVisible()
      await expect(page.getByText('口座残高合計: 0円', { exact: true })).toBeVisible()
      await shot('dashboard')
      const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
      const me = await request.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      expect(me.status()).toBe(200)
      expect(await me.json()).toMatchObject({ displayName: user.displayName })
      await page.goto('/recipes/iphone-shortcut')
      await page.reload()
      await expect(page.getByRole('link', { name: 'ショートカットを追加' })).toBeVisible()
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

// ---- 画面(静的ファイル)の応答の安全用ヘッダー (#513) ----
// frontend/public/_headers の内容。値を変えるときは、ここと docs/details/api-design.md も合わせる。
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

test('画面・スクリプト・Service Workerの応答に安全用ヘッダーが付く (#513)', async ({ page, request, consoleGuard }) => {
  consoleGuard.watch(page)
  await page.goto('/login')
  const assets = await page.locator('script[src], link[rel="stylesheet"]').evaluateAll((els) => els.map((el) => el.getAttribute('src') ?? el.getAttribute('href')!))
  expect(assets.length).toBeGreaterThanOrEqual(2)
  // 直接開くHTML(存在しないパスはSPAとして同じHTMLを返す)と、スクリプト・スタイル・Service Worker・マニフェスト。
  for (const path of ['/', '/login', '/menu', '/settings/account', ...assets, '/sw.js', '/manifest.webmanifest']) {
    const headers = (await request.get(path)).headers()
    expect(headers['content-security-policy'], path).toBe(PAGE_CSP)
    expect(headers['x-content-type-options'], path).toBe('nosniff')
    expect(headers['x-frame-options'], path).toBe('DENY')
    expect(headers['referrer-policy'], path).toBe('strict-origin-when-cross-origin')
    expect(headers['strict-transport-security'], path).toBe('max-age=31536000')
    expect(headers['permissions-policy'], path).toBe('geolocation=(), microphone=(), payment=(), usb=()')
  }
  // APIの応答はAPI用のヘッダー(#512)のまま。画面用の設定が重なったり、上書きしたりしない。
  for (const path of ['/api/auth/me', '/health']) {
    expect((await request.get(path)).headers()['content-security-policy'], path).toBe("default-src 'none'; frame-ancestors 'none'")
  }
})

test('インラインのスクリプトはブラウザが実行しない (#513)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  // この確認でわざと起こす違反の報告だけを許可する。
  consoleGuard.allow({ message: /Content Security Policy/ })
  await page.goto('/login')
  const result = await page.evaluate(() => new Promise<{ ran: boolean; directive: string }>((resolve) => {
    document.addEventListener('securitypolicyviolation', (event) => {
      resolve({ ran: (window as unknown as { inlineRan?: boolean }).inlineRan === true, directive: event.effectiveDirective })
    }, { once: true })
    const script = document.createElement('script')
    script.textContent = 'window.inlineRan = true'
    document.head.append(script)
  }))
  expect(result).toEqual({ ran: false, directive: 'script-src-elem' })
})

for (const width of [1280, 390, 320]) {
  test(`安全用ヘッダーを付けた状態で、主要な画面がエラーなく表示・操作できる ${width}px (#513)`, async ({ page, consoleGuard }) => {
    await page.setViewportSize({ width, height: 900 })
    consoleGuard.watch(page)
    // 方針への違反は、コンソールのエラーに加えてブラウザのイベントでも数える。
    await page.addInitScript(() => {
      const store = window as unknown as { cspViolations: string[] }
      store.cspViolations = []
      document.addEventListener('securitypolicyviolation', (event) => store.cspViolations.push(event.effectiveDirective + ' ' + event.blockedURI))
    })
    const violations: string[] = []
    const collect = async () => {
      violations.push(...await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations.splice(0)))
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    }
    await setupUserWithHousehold(page, `csp${width}`)
    await expect(page.getByRole('heading', { name: '今日の状況', exact: true })).toBeVisible()
    await collect()
    for (const [path, heading] of [
      ['/menu', '献立表'], ['/recipes', 'レシピ一覧'], ['/zaiko', '在庫一覧'], ['/zaiko/shopping', '買い物リスト'],
      ['/kakeibo', '家計簿'], ['/warikan', '割り勘・精算'], ['/accounts', '口座・カード管理'], ['/fixed-costs', '固定費管理'],
      ['/events', 'イベント一覧'], ['/categories', '家計簿カテゴリー管理'], ['/settings', '設定'], ['/settings/display', '表示設定'],
      ['/settings/account', 'アカウント設定'], ['/household/settings', '世帯設定'],
    ] as const) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible()
      await collect()
    }
    // 入力画面(動的に追加する要素や、style属性を使う部品)も開く。
    await page.goto('/kakeibo')
    await page.getByRole('button', { name: '収支を登録' }).click()
    await expect(page.getByRole('dialog', { name: '収支を登録' })).toBeVisible()
    await collect()
    await page.goto('/recipes')
    await page.getByRole('button', { name: 'レシピを登録' }).click()
    await page.getByLabel('タイトル').fill('[E2E_TEST] 安全用ヘッダーの確認')
    await page.getByLabel('材料').fill('[E2E_TEST] 材料')
    await page.getByRole('button', { name: '登録', exact: true }).click()
    await expect(page.getByRole('button', { name: /安全用ヘッダーの確認/ }).first()).toBeVisible()
    await collect()
    expect(violations).toEqual([])
  })
}

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from './console-guard'

// Separate, persistent fake demo DB at localhost:8788. Never use normal dev or E2E reset storage.
const privateDir = process.env.HOME_VISUAL_PRIVATE_DIR!
const imageDir = process.env.HOME_VISUAL_IMAGE_DIR!
const stage = process.env.HOME_VISUAL_STAGE ?? 'after'
// 参考資料（静的HTML）はリポジトリ外にも置けるよう、場所を環境変数で受け取る。
const referenceDir = process.env.HOME_VISUAL_REFERENCE_DIR
test.skip(!privateDir || !imageDir, '専用previewと外部画像保存先を指定する視覚比較専用テスト')
const liveDemo = process.env.HOME_VISUAL_LIVE_DEMO === '1'
const date = liveDemo ? new Date(Date.now() + 9 * 3600000).toISOString().slice(0,10) : '2026-11-15'
const weekDate = new Date(date + 'T00:00:00Z')
weekDate.setUTCDate(weekDate.getUTCDate() - (weekDate.getUTCDay() + 6) % 7)
const week = weekDate.toISOString().slice(0,10)
test.use({ trace: 'off', video: 'off', screenshot: 'off', timezoneId: 'Asia/Tokyo' })
for (const width of [390, 320, 1280]) {
  test('資料01〜07と比較する固定データ ' + width + 'px', async ({ page, browser, consoleGuard }) => {
    consoleGuard.watch(page)
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 })
    await page.clock.setFixedTime(liveDemo ? new Date() : new Date('2026-11-08T10:00:00+09:00'))
    await mkdir(privateDir, { recursive: true })
    await mkdir(join(imageDir, stage), { recursive: true })
    const credentialFile = join(privateDir, 'demo-credential.json')
    let credential: { email: string; password: string; seeded?: boolean }
    try { credential = JSON.parse(await readFile(credentialFile, 'utf8')) } catch {
      credential = { email: 'e2euser_visual_pilot_' + randomUUID() + '@example.com', password: 'Demo7-' + randomUUID() }
      const response = await page.request.post('/api/auth/register', { data: { ...credential, displayName: 'e2euser_画面確認' } })
      expect(response.status(), 'demo registration status').toBe(201)
      await writeFile(credentialFile, JSON.stringify(credential))
    }
    const loginResponse = await page.request.post('/api/auth/login', { data: { email: credential.email, password: credential.password } })
    expect(loginResponse.status(), 'normal demo login status').toBe(200)
    const tokens = await loginResponse.json()
    const headers = { Authorization: 'Bearer ' + tokens.accessToken }
    const post = async (path: string, data: unknown) => {
      const response = await page.request.post('/api/' + path, { headers, data })
      expect(response.status(), 'fixture ' + path + ' status').toBe(201)
      return response.json()
    }
    if (!credential.seeded) {
      await post('households', { name: '[E2E_TEST] UI比較世帯' })
      const account = await post('accounts', { name: '[E2E_TEST] 給与口座', type: 'bank', balance: 0 })
      const incomeCategories = await (await page.request.get('/api/income-categories', { headers })).json()
      const expenseCategories = await (await page.request.get('/api/kakeibo-categories', { headers })).json()
      await post('incomes', { incomeDate: date, amount: 250000, content: '[E2E_TEST] 給与', categoryId: incomeCategories[0].id, accountId: account.id })
      await post('expenses', { expenseDate: date, amount: 2800, purpose: '[E2E_TEST] 食材の買い出し', categoryId: expenseCategories[0].id })
      await post('fixed-costs', { name: '[E2E_TEST] 家賃', amount: 78000, paymentDay: Number(date.slice(-2)), personal: true })
      await post('events', { name: '[E2E_TEST] 家族で公園', eventDate: date, personal: false })
      const recipe = await post('recipes', { title: '[E2E_TEST] 野菜たっぷりカレー', sourceType: 'manual', ingredients: 'にんじん、玉ねぎ、じゃがいも', steps: '野菜を切る。\n煮込んで仕上げる。' })
      await post('menu-entries', { recipeId: recipe.id, weekStartDate: week })
      await post('menu-entries', { freeTextMemo: '[E2E_TEST] 週末は家族でゆっくり', weekStartDate: week })
      credential.seeded = true
      await writeFile(credentialFile, JSON.stringify(credential))
    }
    await page.addInitScript(({ access, refresh }) => {
      localStorage.setItem('homelog.accessToken', access)
      localStorage.setItem('homelog.refreshToken', refresh)
    }, { access: tokens.accessToken, refresh: tokens.refreshToken })
    await page.goto('/')
    const cell = page.getByRole('button', { name: new RegExp('^' + date) })
    await expect(cell).toBeVisible()
    await expect(cell.locator('.calendar-dot')).toHaveCount(4)
    await expect(page.locator('.calendar-grid')).toBeVisible()
    if (stage !== 'before') await expect(page.locator('.dashboard-today-row')).toHaveCount(2)
    await page.screenshot({ path: join(imageDir, stage, '01-home-' + width + '.png') })
    if (stage !== 'before') {
      expect(await page.locator('.calendar-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(7)
      expect(await page.locator('.global-nav').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)')
      const primary = page.getByRole('navigation', { name: '主要機能', exact: true })
      await expect(primary.getByRole('link')).toHaveText(['ホーム', '献立', '在庫', '家計簿'])
      await expect(primary.getByRole('link', { name: '献立表', exact: true })).toHaveAttribute('href','/menu')
      await expect(primary.getByRole('link', { name: '在庫', exact: true })).toHaveAttribute('href','/zaiko')
      await expect(primary.getByRole('button', { name: 'その他', exact: true })).toBeVisible()
      const actions = page.locator('.account-nav a, .account-nav button, .primary-nav .nav-link, .calendar-toolbar button, .dashboard-today-row')
      const actionSizes = await actions.evaluateAll(nodes => nodes.map(node => ({ name:node.getAttribute('aria-label') ?? node.textContent?.trim(), width:node.getBoundingClientRect().width, height:node.getBoundingClientRect().height })))
      for (const size of actionSizes) { expect(size.width, size.name ?? '').toBeGreaterThanOrEqual(44); expect(size.height, size.name ?? '').toBeGreaterThanOrEqual(44) }
      const dots = await cell.locator('.calendar-dot').evaluateAll(nodes => nodes.map(node => { const b=node.getBoundingClientRect(); return {left:b.left,right:b.right,top:b.top,color:getComputedStyle(node).backgroundColor} }))
      expect(dots.map(d=>d.color)).toEqual(['rgb(168, 85, 165)', 'rgb(53, 155, 105)', 'rgb(66, 120, 182)', 'rgb(198, 140, 56)'])
      const cellRect = await cell.boundingBox()
      expect(new Set(dots.map(d=>d.top)).size).toBe(1)
      expect(Math.min(...dots.map(d=>d.left))).toBeGreaterThanOrEqual(cellRect!.x)
      expect(Math.max(...dots.map(d=>d.right))).toBeLessThanOrEqual(cellRect!.x+cellRect!.width)
    }
    await cell.click()
    const dialog = page.getByRole('dialog', { name: '日次詳細', exact: true })
    await expect(dialog).toBeVisible()
    if (process.env.HOME_VISUAL_METRICS === '1' && width === 390) {
      expect(referenceDir, 'HOME_VISUAL_METRICS=1 には HOME_VISUAL_REFERENCE_DIR が必要').toBeTruthy()
      const referenceUrl = (name: string) => pathToFileURL(join(referenceDir!, 'source', name)).href
      const sample = async (target: typeof page, selectors: Record<string,string>) => target.evaluate(selectors => Object.fromEntries(Object.entries(selectors).map(([key, selector]) => {
        const node = document.querySelector(selector); if (!node) return [key, null]
        const css = getComputedStyle(node)
        return [key, { fontFamily:css.fontFamily,fontSize:css.fontSize,fontWeight:css.fontWeight,textDecoration:css.textDecorationLine,color:css.color,lineHeight:css.lineHeight }]
      })), selectors)
      const actual = await sample(page, { body:'body',brand:'.nav-logo',month:'.calendar-month',date:'.calendar-day-date strong',today:'.dashboard-today-row',todayLabel:'.dashboard-today-row > span:first-child',dayHeader:'.day-detail-header h2',accordion:'.day-section-title' })
      const referenceContext = await browser.newContext({ viewport:{ width:390,height:844 } })
      try {
        const referencePage = await referenceContext.newPage()
        await referencePage.goto(referenceUrl('01_ホーム_月間カレンダー.html'))
        const referenceHome = await sample(referencePage, {body:'body',brand:'.brand',month:'.switch',date:'.day',today:'.page-content > .panel:nth-child(2) .row'})
        await referencePage.goto(referenceUrl('02_日付詳細_初期表示.html'))
        const referenceDay = await sample(referencePage, {dayHeader:'.header h2',accordion:'.acc-title'})
        await writeFile(join(imageDir, 'font-metrics-390.json'),JSON.stringify({actual,referenceHome,referenceDay},null,2))
      } finally { await referenceContext.close() }
    }
    const toggles = ['今週の献立', 'イベント', '収支', '固定費'].map(label => dialog.getByRole('button', { name: new RegExp('^' + label + '.*件') }))
    for (const toggle of toggles) await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await page.screenshot({ path: join(imageDir, stage, '02-initial-' + width + '.png') })
    await toggles[0].click(); await toggles[1].click()
    await expect(dialog).toContainText('[E2E_TEST] 家族で公園')
    await page.screenshot({ path: join(imageDir, stage, '03-life-' + width + '.png') })
    await toggles[0].click(); await toggles[1].click(); await toggles[2].click(); await toggles[3].click()
    await expect(dialog).toContainText(liveDemo ? '[E2E_TEST] 家賃' : '計上予定')
    await page.screenshot({ path: join(imageDir, stage, '04-money-' + width + '.png') })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    const close = dialog.getByRole('button', { name: '日付詳細を閉じる', exact: true })
    await close.click()
    await expect(cell).toBeFocused()

    if (stage !== 'before') {
      const empty = { date, weekStartDate: week, menuEntries: [], events: [], finance: { income: 0, expense: 0, balance: 0, incomes: [], expenses: [] }, fixedCosts: [] }
      await page.route('**/api/dashboard/day-detail?date=' + date, route => route.fulfill({ json: empty }))
      await cell.click()
      for (const toggle of toggles) { await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await toggle.click() }
      await expect(dialog).toContainText('0件')
      await page.screenshot({ path: join(imageDir, stage, '05-empty-' + width + '.png') })
      await close.click()
      await page.unroute('**/api/dashboard/day-detail?date=' + date)
      let releaseLoading = () => {}
      let loadingCompleted = () => {}
      const heldLoading = new Promise<void>(resolve => { releaseLoading = resolve })
      const completedLoading = new Promise<void>(resolve => { loadingCompleted = resolve })
      await page.route('**/api/dashboard/day-detail?date=' + date, async route => {
        await heldLoading
        try { await route.fulfill({ json: empty }) } catch { /* closed request */ } finally { loadingCompleted() }
      })
      try {
        await cell.click()
        await expect(dialog).toContainText('読み込み中')
        await expect(dialog).not.toContainText('0件')
        await page.screenshot({ path: join(imageDir, stage, '06-loading-' + width + '.png') })
        await close.click()
      } finally { releaseLoading(); await completedLoading }
      await page.unroute('**/api/dashboard/day-detail?date=' + date)
      consoleGuard.allow({ url: new RegExp('/api/dashboard/day-detail[?]date=' + date + '$'), message: /^Failed to load resource:.*500/ })
      await page.route('**/api/dashboard/day-detail?date=' + date, route => route.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' }))
      await cell.click()
      await expect(dialog.getByRole('alert')).toBeVisible()
      await expect(dialog).not.toContainText('0件')
      await page.screenshot({ path: join(imageDir, stage, '07-error-' + width + '.png') })
      await page.unroute('**/api/dashboard/day-detail?date=' + date)
      await dialog.getByRole('button', { name: /再試行/ }).click()
      await expect(toggles[0]).toHaveAttribute('aria-expanded', 'false')
      await close.click()
      await expect(cell).toBeFocused()
    }
  })
}

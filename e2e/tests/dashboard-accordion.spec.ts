import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

// ホームのカードの折りたたみと、見出しの行のリンク(#493)。
const titles = ['今日の状況', '買い物・在庫', '個人の財政', '今月のお金', 'イベント別支出']

for (const width of [1280, 390, 320]) {
  test(`ホームのカードを折りたたみ、開閉を再読み込み後も保つ ${width}px (#493)`, async ({ page, consoleGuard }) => {
    await page.setViewportSize({ width, height: 844 })
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, `dashboard_accordion_${width}`)
    const headers = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('homelog.accessToken'))}` }
    const categories = await (await page.request.get('/api/zaiko-categories', { headers })).json()
    for (let index = 0; index < 10; index++) {
      const response = await page.request.post('/api/inventory-items', { headers, data: { name: `[E2E_TEST] 折りたたみ確認の品目${index}`, categoryId: categories[0].id, storeId: null, price: 100, quantity: 0, threshold: 1 } })
      expect(response.status()).toBe(201)
    }
    await page.goto('/')
    const card = (title: string) => page.locator('.card').filter({ has: page.getByRole('heading', { level: 2, name: title, exact: true }) })
    const toggle = (title: string) => card(title).getByRole('button', { name: title + 'の開閉', exact: true })
    const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    const shot = async (label: string) => {
      if (!process.env.DASHBOARD_ACCORDION_SHOTS_DIR) return
      await mkdir(process.env.DASHBOARD_ACCORDION_SHOTS_DIR, { recursive: true })
      await page.screenshot({ path: join(process.env.DASHBOARD_ACCORDION_SHOTS_DIR, `dashboard-${label}-${width}.png`), fullPage: true })
    }

    const stock = card('買い物・在庫')
    await expect(stock.getByRole('list', { name: '在庫リスト', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /の開閉$/ })).toHaveCount(5)
    for (const title of titles) {
      await expect(toggle(title)).toHaveAttribute('aria-expanded', 'true')
      const box = (await toggle(title).boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      // 開閉ボタンはタイトルと同じ段の右端に置く。
      const titleBox = (await card(title).getByRole('heading', { level: 2, name: title, exact: true }).boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(titleBox.x + titleBox.width - 1)
      expect(box.y).toBeLessThan(titleBox.y + titleBox.height)
      expect(box.y + box.height).toBeGreaterThan(titleBox.y)
    }
    // リンクはボタンの見た目で、押せる範囲は44px以上。カードからはみ出さない。
    const links: [string, string, string][] = [
      ['買い物・在庫', '買い物リストを見る', '/zaiko/shopping'], ['買い物・在庫', '在庫一覧を見る', '/zaiko'],
      ['個人の財政', '口座・カード管理を見る', '/accounts'], ['今月のお金', '精算一覧を見る', '/warikan'], ['イベント別支出', 'イベント一覧を見る', '/events'],
    ]
    for (const [title, name, href] of links) {
      const link = card(title).getByRole('link', { name, exact: true })
      await expect(link).toHaveAttribute('href', href)
      const [box, cardBox] = await Promise.all([link.boundingBox(), card(title).boundingBox()])
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.x).toBeGreaterThanOrEqual(cardBox!.x)
      expect(box!.x + box!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width)
    }
    await noOverflow()
    await shot('open')

    // 閉じると本文が隠れてカードが短くなる。タイトルの右のリンクは閉じていても押せる。
    const openHeight = (await stock.boundingBox())!.height
    await toggle('買い物・在庫').click()
    await expect(toggle('買い物・在庫')).toHaveAttribute('aria-expanded', 'false')
    await expect(stock.getByRole('list', { name: '在庫リスト', exact: true })).toBeHidden()
    await expect(stock.getByRole('link', { name: '在庫一覧を見る', exact: true })).toBeHidden()
    expect((await stock.boundingBox())!.height).toBeLessThan(openHeight / 2)
    await toggle('個人の財政').click()
    await expect(card('個人の財政').getByText(/口座残高合計:/)).toBeHidden()
    await expect(card('個人の財政').getByRole('link', { name: '口座・カード管理を見る', exact: true })).toBeVisible()
    await noOverflow()
    await shot('collapsed')

    // 再読み込みしても開閉が保たれる。キーボードでも開閉できる。
    await page.reload()
    await expect(toggle('買い物・在庫')).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle('個人の財政')).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle('今月のお金')).toHaveAttribute('aria-expanded', 'true')
    await toggle('買い物・在庫').focus()
    await page.keyboard.press('Enter')
    await expect(toggle('買い物・在庫')).toHaveAttribute('aria-expanded', 'true')
    await expect(toggle('買い物・在庫')).toBeFocused()
    await expect(stock.getByRole('list', { name: '在庫リスト', exact: true })).toBeVisible()

    // 閉じているカードのリンクから移動できる。
    await card('個人の財政').getByRole('link', { name: '口座・カード管理を見る', exact: true }).click()
    await expect(page).toHaveURL(/\/accounts$/)
  })
}

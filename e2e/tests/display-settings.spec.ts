import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

async function dashboardCardHeadings(page: Page) {
  return page.locator('.dashboard-summary-grid > .card h2').allTextContents()
}

async function orderListCards(page: Page) {
  return page.getByRole('list', { name: 'ダッシュボードのカード順' }).getByRole('listitem').evaluateAll((items) => items.map((item) => item.getAttribute('data-card')))
}

test.describe('S-21 表示設定とカード並べ替え', () => {
  test('表示OFFとボタン操作の並べ替えを保存すると、S-04へ遷移して反映される', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'display_settings')

    await page.goto('/settings/display')
    await expect(page.getByText('よく使う品目')).toHaveCount(0)
    await page.getByRole('checkbox', { name: '個人の財政' }).uncheck()
    await expect.poll(() => orderListCards(page)).toEqual(['today', 'stock', 'money', 'eventExpenses'])

    const moveUp = page.getByRole('button', { name: '「イベント別支出」を上へ移動' })
    await moveUp.click()
    await moveUp.click()
    await moveUp.click()
    await expect.poll(() => orderListCards(page)).toEqual(['eventExpenses', 'today', 'stock', 'money'])
    await expect(page.getByRole('status')).toHaveText('「イベント別支出」を1番目に移動しました')

    await page.getByRole('group', { name: 'カレンダー' }).getByLabel('イベント').uncheck()
    await page.getByRole('button', { name: '保存' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: '月間カレンダー' })).toBeVisible()
    await expect.poll(() => dashboardCardHeadings(page)).toEqual(['イベント別支出', '今日の状況', '買い物・在庫', '今月のお金'])
    await expect(page.getByRole('heading', { name: '個人の財政' })).toHaveCount(0)

    await page.goto('/settings/display')
    await expect(page.getByRole('checkbox', { name: '個人の財政' })).not.toBeChecked()
    await expect(page.getByRole('group', { name: 'カレンダー' }).getByLabel('イベント')).not.toBeChecked()
    await page.getByRole('checkbox', { name: '個人の財政' }).check()
    await expect.poll(() => orderListCards(page)).toEqual(['eventExpenses', 'today', 'stock', 'finance', 'money'])
  })

  test('ドラッグ操作で並べ替えて保存できる', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'display_settings_drag')

    await page.goto('/settings/display')
    const list = page.getByRole('list', { name: 'ダッシュボードのカード順' })
    await list.locator('[data-card="money"]').dragTo(list.locator('[data-card="today"]'))
    await expect.poll(() => orderListCards(page)).toEqual(['money', 'today', 'stock', 'finance', 'eventExpenses'])

    await page.getByRole('button', { name: '保存' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect.poll(() => dashboardCardHeadings(page)).toEqual(['今月のお金', '今日の状況', '買い物・在庫', '個人の財政', 'イベント別支出'])
  })
})

// 表示設定の見た目に関わる構成(#503)。カードごとの枠・スイッチの見た目の親項目・並べ替え・保存。
for (const width of [1280, 390, 320]) {
  test(`表示設定はカードごとに枠を分け、切り替えを保存するまで反映しない ${width}px (#503)`, async ({ page, consoleGuard }) => {
    await page.setViewportSize({ width, height: 844 })
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, `display_layout_${width}`)
    let puts = 0
    page.on('request', request => { if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/user-settings') puts++ })
    await page.goto('/settings/display')
    const panel = page.getByTestId('display-settings-panel')
    await expect(panel.getByRole('heading', { level: 2, name: '表示設定', exact: true })).toBeVisible()
    await expect(panel.getByRole('group')).toHaveCount(6)
    const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await noOverflow()

    // 押せる範囲は44px以上。親項目は行全体、内訳は1つずつ、並べ替えは上下のボタン。
    const back = panel.getByRole('link', { name: '設定に戻る', exact: true })
    expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    for (const name of ['今日の状況', '買い物・在庫', '個人の財政', '今月のお金', 'イベント別支出', 'カレンダー']) {
      const group = panel.getByRole('group', { name, exact: true })
      const [box, groupBox] = await Promise.all([group.getByRole('checkbox', { name, exact: true }).boundingBox(), group.boundingBox()])
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.width).toBeGreaterThanOrEqual(groupBox!.width - 40)
      expect(await group.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    }
    for (const item of await panel.locator('.display-card-item').all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    const list = panel.getByRole('list', { name: 'ダッシュボードのカード順', exact: true })
    for (const button of await list.getByRole('button').all()) {
      const box = (await button.boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
    }
    for (const row of await list.getByRole('listitem').all()) expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    const save = panel.getByRole('button', { name: '保存', exact: true })
    const [saveBox, panelBox] = await Promise.all([save.boundingBox(), panel.boundingBox()])
    expect(saveBox!.height).toBeGreaterThanOrEqual(48)
    expect(saveBox!.width).toBeGreaterThanOrEqual(panelBox!.width - 2)
    // 保存ボタンは画面に固定せず、並べ替えの後に置く。
    expect(await save.evaluate(el => getComputedStyle(el).position)).toBe('static')
    expect(saveBox!.y).toBeGreaterThanOrEqual((await list.boundingBox())!.y)

    // 親項目をキーボードで切り替える。保存するまで送信せず、未保存であることを示す。
    const unsaved = panel.getByText('未保存の変更があります。「保存」を押すとダッシュボードに反映されます。', { exact: true })
    await expect(unsaved).toHaveCount(0)
    const stock = panel.getByRole('group', { name: '買い物・在庫', exact: true })
    const parent = stock.getByRole('checkbox', { name: '買い物・在庫', exact: true })
    await parent.focus()
    expect(await stock.locator('.ui-switch-track').evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid')
    await page.keyboard.press('Space')
    await expect(parent).not.toBeChecked()
    await expect(stock.getByText('非表示', { exact: true })).toBeVisible()
    await expect(stock.getByLabel('買い物リスト')).toBeDisabled()
    await expect(unsaved).toBeVisible()
    await expect.poll(() => orderListCards(page)).toEqual(['today', 'finance', 'money', 'eventExpenses'])
    await noOverflow()
    const directory = process.env.SETTINGS_SHOTS_DIR
    if (directory) { await mkdir(directory, { recursive: true }); await page.screenshot({ path: join(directory, `display-settings-${width}.png`), fullPage: true }) }
    expect(puts).toBe(0)

    // スイッチの上でなく見出しの位置を押しても、親項目が切り替わる。元へ戻すと未保存の表示が消える。
    await stock.locator('.display-card-head').click({ position: { x: 90, y: 22 } })
    await expect(parent).toBeChecked()
    await expect(unsaved).toHaveCount(0)

    // 内訳を1つ外して保存すると、ホームへ戻って反映される。
    await stock.getByLabel('在庫リスト').uncheck()
    await save.click()
    await expect(page).toHaveURL(/\/$/)
    expect(puts).toBe(1)
    const stockCard = page.locator('.card').filter({ has: page.getByRole('heading', { level: 2, name: '買い物・在庫', exact: true }) })
    await expect(stockCard.getByRole('heading', { level: 3, name: '買い物リスト', exact: true })).toBeVisible()
    await expect(stockCard.getByRole('heading', { level: 3, name: '在庫リスト', exact: true })).toHaveCount(0)
  })
}

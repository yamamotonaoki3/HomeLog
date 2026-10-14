import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

test('モバイルではカレンダーを先頭にしてサマリーカードを1列で表示する', async ({ page, consoleGuard }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  consoleGuard.watch(page)
  await setupUserWithHousehold(page, 'dashboard-layout')

  const calendar = page.locator('.calendar-panel')
  const summaryCards = page.locator('.dashboard-summary-grid')
  const cards = summaryCards.locator('.card')

  await expect(calendar.getByRole('heading', { name: '月間カレンダー' })).toBeVisible()
  await expect(cards).toHaveCount(5)
  await expect(cards.nth(0).getByRole('heading', { name: '今日の状況' })).toBeVisible()
  await expect(cards.nth(1).getByRole('heading', { name: '買い物・在庫' })).toBeVisible()
  await expect(cards.nth(2).getByRole('heading', { name: '個人の財政' })).toBeVisible()
  await expect(cards.nth(3).getByRole('heading', { name: '今月のお金' })).toBeVisible()
  await expect(cards.nth(4).getByRole('heading', { name: 'イベント別支出' })).toBeVisible()

  const [calendarBox, firstCardBox, secondCardBox] = await Promise.all([
    calendar.boundingBox(),
    cards.nth(0).boundingBox(),
    cards.nth(1).boundingBox(),
  ])
  expect(calendarBox).not.toBeNull()
  expect(firstCardBox).not.toBeNull()
  expect(secondCardBox).not.toBeNull()
  expect(calendarBox!.y).toBeLessThan(firstCardBox!.y)
  expect(secondCardBox!.y).toBeGreaterThan(firstCardBox!.y)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  const primaryNavigation = page.getByRole('navigation', { name: '主要機能' })
  const notificationAlarm = page.getByRole('img', { name: '通知アラーム（0件）' })
  const settings = page.getByRole('link', { name: '設定を開く' })
  const logout = page.getByRole('button', { name: 'ログアウト' })
  await expect(notificationAlarm).toBeVisible()
  await cards.nth(4).getByRole('link', { name: 'イベント一覧を見る' }).scrollIntoViewIfNeeded()
  const [lastLinkBox, navBox, alarmBox, settingsBox, logoutBox] = await Promise.all([
    cards.nth(4).getByRole('link', { name: 'イベント一覧を見る' }).boundingBox(),
    primaryNavigation.boundingBox(),
    notificationAlarm.boundingBox(),
    settings.boundingBox(),
    logout.boundingBox(),
  ])
  expect(lastLinkBox).not.toBeNull()
  expect(navBox).not.toBeNull()
  expect(alarmBox).not.toBeNull()
  expect(settingsBox).not.toBeNull()
  expect(logoutBox).not.toBeNull()
  expect(lastLinkBox!.y + lastLinkBox!.height).toBeLessThanOrEqual(navBox!.y)
  expect(alarmBox!.x + alarmBox!.width).toBeLessThanOrEqual(settingsBox!.x)
  expect(settingsBox!.x + settingsBox!.width).toBeLessThanOrEqual(logoutBox!.x)
})

test('PCではカレンダーの下にサマリーカードを複数列で表示する', async ({ page, consoleGuard }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  consoleGuard.watch(page)
  await setupUserWithHousehold(page, 'dashboard-layout-desktop')

  const calendar = page.locator('.calendar-panel')
  const cards = page.locator('.dashboard-summary-grid .card')
  const notificationAlarm = page.getByRole('img', { name: '通知アラーム（0件）' })
  const settings = page.getByRole('link', { name: '設定を開く' })
  const logout = page.getByRole('button', { name: 'ログアウト' })
  await expect(calendar.getByRole('heading', { name: '月間カレンダー' })).toBeVisible()
  await expect(cards).toHaveCount(5)
  await expect(notificationAlarm).toBeVisible()

  const [calendarBox, firstCardBox, secondCardBox, alarmBox, settingsBox, logoutBox] = await Promise.all([
    calendar.boundingBox(),
    cards.nth(0).boundingBox(),
    cards.nth(1).boundingBox(),
    notificationAlarm.boundingBox(),
    settings.boundingBox(),
    logout.boundingBox(),
  ])
  expect(calendarBox).not.toBeNull()
  expect(firstCardBox).not.toBeNull()
  expect(secondCardBox).not.toBeNull()
  expect(alarmBox).not.toBeNull()
  expect(settingsBox).not.toBeNull()
  expect(logoutBox).not.toBeNull()
  expect(calendarBox!.y).toBeLessThan(firstCardBox!.y)
  expect(secondCardBox!.y).toBe(firstCardBox!.y)
  expect(alarmBox!.x + alarmBox!.width).toBeLessThanOrEqual(settingsBox!.x)
  expect(settingsBox!.x + settingsBox!.width).toBeLessThanOrEqual(logoutBox!.x)
})

for (const width of [1280, 390, 320]) {
  test(width + 'pxで口座管理リンクを残高の下に表示し管理画面へ移動できる', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 })
    await setupUserWithHousehold(page, 'dashboard-accounts-' + width)
    await page.goto('/accounts')
    await page.getByRole('button', { name: '口座を登録' }).click()
    await page.getByLabel('口座名').fill('[E2E_TEST] 生活口座')
    await page.getByLabel('初期残高').fill('13000')
    await page.getByRole('button', { name: '登録', exact: true }).click()
    await expect(page.getByTestId('accounts-panel')).toContainText('残高: 13000円')
    await page.goto('/')

    const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: '個人の財政', exact: true }) })
    const balance = card.locator('p').filter({ hasText: '口座残高合計:' })
    const link = card.getByRole('link', { name: '口座・カード管理を見る', exact: true })
    await expect(balance).toHaveText('口座残高合計: 13000円')
    await expect(link).toHaveCount(1)
    await expect(link).toHaveAttribute('href', '/accounts')
    await link.scrollIntoViewIfNeeded()
    const [balanceBox, linkBox, cardBox] = await Promise.all([balance.boundingBox(), link.boundingBox(), card.boundingBox()])
    expect(balanceBox).not.toBeNull()
    expect(linkBox).not.toBeNull()
    expect(cardBox).not.toBeNull()
    expect(linkBox!.y).toBeGreaterThanOrEqual(balanceBox!.y + balanceBox!.height)
    expect(linkBox!.x).toBeGreaterThanOrEqual(cardBox!.x)
    expect(linkBox!.x + linkBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    if (width < 800) {
      const navBox = await page.getByRole('navigation', { name: '主要機能' }).boundingBox()
      expect(navBox).not.toBeNull()
      expect(linkBox!.y + linkBox!.height).toBeLessThanOrEqual(navBox!.y)
    }
    if (process.env.ISSUE_217_SHOTS_DIR) {
      await page.screenshot({ path: process.env.ISSUE_217_SHOTS_DIR + '/dashboard-' + width + '.png', fullPage: true })
    }
    await link.click()
    await expect(page).toHaveURL(/\/accounts$/)
    await expect(page.getByRole('heading', { name: '口座・カード管理', exact: true })).toBeVisible()
  })
}

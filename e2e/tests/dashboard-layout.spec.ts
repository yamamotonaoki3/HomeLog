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
  await expect(cards).toHaveCount(4)
  await expect(cards.nth(0).getByRole('heading', { name: '今日の状況' })).toBeVisible()
  await expect(cards.nth(1).getByRole('heading', { name: '買い物・在庫' })).toBeVisible()
  await expect(cards.nth(2).getByRole('heading', { name: '個人の財政' })).toBeVisible()
  await expect(cards.nth(3).getByRole('heading', { name: '今月のお金' })).toBeVisible()

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
  await cards.nth(3).getByRole('link', { name: 'イベント一覧を見る' }).scrollIntoViewIfNeeded()
  const [lastLinkBox, navBox, alarmBox, settingsBox, logoutBox] = await Promise.all([
    cards.nth(3).getByRole('link', { name: 'イベント一覧を見る' }).boundingBox(),
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
  await expect(cards).toHaveCount(4)
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

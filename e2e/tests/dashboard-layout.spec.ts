import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

test('モバイルではカレンダーを先頭にしてサマリーカードを1列で表示する', async ({ page, consoleGuard }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  consoleGuard.watch(page)
  await setupUserWithHousehold(page, 'dashboard-layout')

  const calendar = page.locator('.calendar-panel')
  const summaryCards = page.locator('.dashboard-summary-grid')
  const cards = summaryCards.locator('.card')

  await expect(calendar.getByRole('heading', { name: '月間カレンダー' })).toBeAttached()
  await expect(cards).toHaveCount(5)
  await expect(cards.nth(0).getByRole('heading', { name: '今日の状況' })).toBeVisible()
  await expect(cards.nth(1).getByRole('heading', { name: '買い物・在庫' })).toBeVisible()
  await expect(cards.nth(2).getByRole('heading', { name: '個人の財政' })).toBeVisible()
  await expect(cards.nth(3).getByRole('heading', { name: '今月のお金' })).toBeVisible()
  await expect(cards.nth(4).getByRole('heading', { name: 'イベント別支出' })).toBeVisible()

  // 見出しは取得中にも表示される。取得完了後の高さでスクロール位置と座標を検証する。
  await expect(cards.nth(1).getByText('買い物リストは空です', { exact: true })).toBeVisible()
  await expect(cards.nth(1).getByText('在庫は登録されていません', { exact: true })).toBeVisible()
  await expect(cards.nth(2).getByText('口座残高合計: 0円', { exact: true })).toBeVisible()
  await expect(cards.nth(4).getByText('イベント別支出: なし', { exact: true })).toBeVisible()

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
  const settings = page.getByRole('link', { name: '設定を開く' })
  await expect(settings).toBeVisible()
  await expect(primaryNavigation.getByRole('link')).toHaveText(['ホーム', '献立', '在庫', '家計簿'])
  await expect(primaryNavigation.getByRole('button', { name: 'その他', exact: true })).toBeVisible()
  await cards.nth(4).getByRole('link', { name: 'イベント一覧を見る' }).scrollIntoViewIfNeeded()
  const [lastLinkBox, navBox] = await Promise.all([
    cards.nth(4).getByRole('link', { name: 'イベント一覧を見る' }).boundingBox(),
    primaryNavigation.boundingBox(),
  ])
  expect(lastLinkBox).not.toBeNull()
  expect(navBox).not.toBeNull()
  expect(lastLinkBox!.y + lastLinkBox!.height).toBeLessThanOrEqual(navBox!.y)
  const header = page.getByRole('banner')
  await expect(header.getByRole('img', { name: '通知アラーム（0件）' })).toBeVisible()
  await expect(header.locator('.header-account-name')).toBeVisible()
  await expect(header.getByRole('button', { name: 'ログアウト' })).toHaveCount(0)
  await expect(header.getByRole('button')).toHaveAttribute('aria-haspopup', 'dialog')
  await page.getByRole('button', { name: 'その他', exact: true }).click()
  const menu = page.getByRole('dialog', { name: 'その他の設定・管理' })
  await expect(menu.getByRole('link')).toHaveCount(9)
  await expect(menu.getByRole('img', { name: /通知アラーム/ })).toHaveCount(0)
  await expect(menu.getByRole('button', { name: 'ログアウト' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'その他', exact: true })).toBeFocused()
})

test('PCではカレンダーの下にサマリーカードを複数列で表示する', async ({ page, consoleGuard }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  consoleGuard.watch(page)
  await setupUserWithHousehold(page, 'dashboard-layout-desktop')

  const calendar = page.locator('.calendar-panel')
  const cards = page.locator('.dashboard-summary-grid .card')
  const settings = page.getByRole('link', { name: '設定を開く' })
  await expect(calendar.getByRole('heading', { name: '月間カレンダー' })).toBeAttached()
  await expect(cards).toHaveCount(5)
  await expect(settings).toBeVisible()

  const [calendarBox, firstCardBox, secondCardBox] = await Promise.all([
    calendar.boundingBox(),
    cards.nth(0).boundingBox(),
    cards.nth(1).boundingBox(),
  ])
  expect(calendarBox).not.toBeNull()
  expect(firstCardBox).not.toBeNull()
  expect(secondCardBox).not.toBeNull()
  expect(calendarBox!.y).toBeLessThan(firstCardBox!.y)
  expect(secondCardBox!.y).toBe(firstCardBox!.y)
  await page.getByRole('button', { name: 'その他', exact: true }).click()
  const menu = page.getByRole('dialog', { name: 'その他の設定・管理' })
  await expect(menu.getByRole('link')).toHaveCount(9)
  await expect(menu.getByRole('img', { name: /通知アラーム/ })).toHaveCount(0)
  await expect(menu.getByRole('button', { name: 'ログアウト' })).toHaveCount(0)
  await menu.getByRole('button', { name: 'メニューを閉じる' }).click()
  await expect(page.getByRole('button', { name: 'その他', exact: true })).toBeFocused()
  const header = page.getByRole('banner')
  await expect(header.getByRole('img', { name: '通知アラーム（0件）' })).toBeVisible()
  await expect(header.locator('.header-account-name')).toBeVisible()
  await expect(header.getByRole('button', { name: 'ログアウト' })).toHaveCount(0)
  await expect(header.getByRole('button')).toHaveAttribute('aria-haspopup', 'dialog')
})

for (const width of [1280, 390, 320]) {
  test(width + 'pxで長い本人名からアカウントモーダルを操作できる', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 })
    await setupUserWithHousehold(page, 'header-account-' + width)
    let name = 'testuser_' + '長い本人名'.repeat(16)
    await page.route('**/api/auth/me', async route => {
      const response = await route.fetch()
      await route.fulfill({ response, json: { ...await response.json(), displayName: name } })
    })
    await page.reload()
    const header = page.getByRole('banner')
    const nameLabel = header.locator('.header-account-name')
    const account = header.getByRole('button', { name, exact: true })
    const alarm = header.getByRole('img', { name: '通知アラーム（0件）' })
    const settings = header.getByRole('link', { name: '設定を開く' })
    const personIcon = account.locator('svg')
    await expect(nameLabel).toHaveText(name)
    await expect(nameLabel).toHaveAttribute('title', name)
    await expect(account).toHaveAttribute('aria-haspopup', 'dialog')
    await expect(account).toHaveAttribute('aria-expanded', 'false')
    await expect(header.getByRole('button', { name: 'ログアウト' })).toHaveCount(0)
    await expect(alarm).toBeVisible()
    // #483: 通知が0件のときは数字のバッジを出さない(ベルの位置と大きさは下の検証で変わらないことを確かめる)。
    await expect(alarm.locator('.notification-alarm-count')).toHaveCount(0)
    await expect(settings).toBeVisible()
    await expect(personIcon).toBeVisible()
    await expect(page.getByRole('button', { name: 'メニューを開く' })).toHaveCount(0)
    const [brandBox, alarmBox, settingsBox, accountBox] = await Promise.all([
      header.locator('.nav-logo').boundingBox(), alarm.boundingBox(), settings.boundingBox(), account.boundingBox(),
    ])
    for (const box of [alarmBox, settingsBox, accountBox]) {
      expect(box).not.toBeNull()
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.width).toBeGreaterThanOrEqual(44)
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    }
    expect(alarmBox!.x + alarmBox!.width).toBeLessThanOrEqual(settingsBox!.x)
    expect(accountBox!.width).toBeLessThanOrEqual(144)
    expect(settingsBox!.x + settingsBox!.width).toBeLessThanOrEqual(accountBox!.x)
    expect(accountBox!.y).toBe(settingsBox!.y)
    expect(alarmBox!.y).toBe(settingsBox!.y)
    expect(Math.abs(brandBox!.y + brandBox!.height / 2 - accountBox!.y - accountBox!.height / 2)).toBeLessThan(1)
    const [iconBox, nameBox] = await Promise.all([personIcon.boundingBox(), nameLabel.boundingBox()])
    expect(iconBox!.width).toBe(16)
    expect(iconBox!.x + iconBox!.width).toBeLessThanOrEqual(nameBox!.x)
    expect(nameBox!.width).toBeGreaterThan(14)
    expect(await nameLabel.evaluate(element => getComputedStyle(element).fontSize)).toBe('13px')
    expect(await nameLabel.evaluate(element => getComputedStyle(element).textOverflow)).toBe('ellipsis')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await account.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'アカウント', exact: true })
    const close = dialog.getByRole('button', { name: 'アカウントメニューを閉じる', exact: true })
    await expect(dialog).toBeVisible()
    await expect(close).toBeFocused()
    await expect(account).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('dialog', { name: 'その他の設定・管理' })).toHaveCount(0)
    const accountSettings = dialog.getByRole('link', { name: 'アカウント設定', exact: true })
    await expect(accountSettings).toHaveAttribute('href', '/settings/account')
    for (const control of [close, accountSettings, dialog.getByRole('button', { name: 'ログアウト', exact: true })]) {
      const box = await control.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
    for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab']) {
      await page.keyboard.press(key)
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(account).toBeFocused()
    await account.press('Space')
    await expect(dialog).toBeVisible()
    await close.click()
    await expect(account).toBeFocused()
    await account.click()
    await dialog.click({ position: { x: 1, y: 1 } })
    await expect(dialog).toBeHidden()
    await expect(account).toBeFocused()
    await account.click()
    await accountSettings.click()
    await expect(page).toHaveURL(/\/settings\/account$/)
    await expect(dialog).toBeHidden()
    name = 'テスト'
    await page.reload()
    await expect(nameLabel).toHaveText(name)
    await expect(nameLabel).toHaveAttribute('title', name)
    const shortAccount = header.getByRole('button', { name, exact: true })
    const shortBox = await shortAccount.boundingBox()
    expect(shortBox!.width).toBeGreaterThanOrEqual(44)
    expect(shortBox!.height).toBeGreaterThanOrEqual(44)
    expect(shortBox!.width).toBeLessThan(accountBox!.width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })

  test(width + 'pxで最新5項目ナビから献立表と在庫に移動できる', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 })
    await setupUserWithHousehold(page, 'primary-nav-five-' + width)
    const nav = page.getByRole('navigation', { name: '主要機能' })
    await expect(nav.getByRole('link')).toHaveText(['ホーム', '献立', '在庫', '家計簿'])
    const controls = nav.locator(':scope > a, :scope > button')
    await expect(controls).toHaveCount(5)
    const boxes = await controls.evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect()
      return { width: box.width, height: box.height }
    }))
    for (const box of boxes) {
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(Math.abs(box.width - boxes[0].width)).toBeLessThan(1)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    const menu = nav.getByRole('link', { name: '献立表', exact: true })
    await expect(menu).toHaveAttribute('title', '献立表を開く')
    await expect(menu.locator('svg')).toBeVisible()
    await menu.click()
    await expect(page).toHaveURL(/\/menu$/)
    await expect(menu).toHaveAttribute('aria-current', 'page')
    await nav.getByRole('link', { name: '在庫', exact: true }).click()
    await expect(page).toHaveURL(/\/zaiko$/)
    await expect(nav.getByRole('link', { name: '在庫', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(nav.getByRole('button', { name: 'その他', exact: true })).not.toHaveClass(/is-active/)
  })

  test(width + 'pxで口座管理リンクを残高の下に表示し管理画面へ移動できる', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 })
    await setupUserWithHousehold(page, 'dashboard-accounts-' + width)
    await page.goto('/accounts')
    await page.getByRole('button', { name: '口座を登録' }).click()
    await page.getByLabel('口座名').fill('[E2E_TEST] 生活口座')
    await page.getByLabel('初期残高').fill('13000')
    await page.getByRole('button', { name: '登録', exact: true }).click()
    const accountRow = page.getByRole('list', { name: '口座一覧' }).getByRole('button', { name: '[E2E_TEST] 生活口座の詳細', exact: true })
    await expect(accountRow.locator('span').last()).toHaveText('13000円')
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

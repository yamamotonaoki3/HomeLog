import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

test.describe('S-04 ダッシュボードカード再設計', () => {
  test('買い物・在庫の実リストとイベント別支出の期間切替を表示し、表示設定を反映する', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'dashboard_cards')
    const jstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)

    await page.goto('/zaiko')
    for (const [name, quantity] of [['[E2E_TEST] 牛乳', '0'], ['[E2E_TEST] 米', '5']]) {
      await page.getByRole('button', { name: '在庫を登録' }).click()
      await page.getByLabel('品名').fill(name)
      await page.getByLabel('在庫個数').fill(quantity)
      await page.getByLabel('買い物リスト追加閾値').fill('1')
      await page.getByRole('button', { name: '保存' }).click()
      await expect(page.getByTestId('inventory-panel').getByRole('button', { name: `${name}の詳細`, exact: true })).toBeVisible()
    }

    const eventName = '[E2E_TEST] カード期間イベント'
    await page.goto('/events')
    await page.getByRole('button', { name: 'イベントを登録' }).click()
    await page.getByLabel('イベント名').fill(eventName)
    await page.getByLabel('日付').fill(jstToday)
    await page.getByRole('button', { name: '登録', exact: true }).click()
    await expect(page.getByTestId('events-panel').locator('.list-row-button').filter({ hasText: eventName })).toBeVisible()

    await page.goto('/kakeibo')
    await page.getByRole('button', { name: '収支を登録', exact: true }).click()
    const modal = page.getByTestId('transaction-modal')
    await modal.getByRole('tab', { name: '支出' }).click()
    const transactionSettings = modal.getByRole('button', { name: 'その他の設定', exact: true })
    if (await transactionSettings.getAttribute('aria-expanded') !== 'true') await transactionSettings.click()
    await modal.getByLabel('イベント（任意）').selectOption({ label: eventName })
    await modal.getByLabel('金額').fill('700')
    await modal.getByLabel('使用用途（任意）').fill('[E2E_TEST] カード期間支出')
    await modal.getByLabel('日時').fill(jstToday)
    await modal.getByRole('button', { name: '登録', exact: true }).click()
    await expect(modal).toBeHidden()

    await page.goto('/')
    await expect(page.getByText('よく使う品目')).toHaveCount(0)
    const shopping = page.getByRole('list', { name: '買い物リスト' })
    await expect(shopping.getByText('[E2E_TEST] 牛乳', { exact: true })).toBeVisible()
    await expect(shopping.getByText('[E2E_TEST] 米', { exact: true })).toHaveCount(0)
    const stock = page.getByRole('list', { name: '在庫リスト' })
    await expect(stock.getByRole('listitem').filter({ hasText: '[E2E_TEST] 牛乳' })).toContainText('（不足）')
    await expect(stock.getByRole('listitem').filter({ hasText: '[E2E_TEST] 米' })).not.toContainText('（不足）')

    const period = page.getByLabel('イベント別支出（対象期間）')
    await expect(period).toHaveValue('year')
    await expect(page.getByRole('list', { name: 'イベント別支出（今年）' })).toContainText(`${eventName}: 700円`)
    await period.selectOption('today')
    await expect(page.getByRole('list', { name: 'イベント別支出（今日）' })).toContainText(`${eventName}: 700円`)
    await period.selectOption('month')
    await expect(page.getByRole('list', { name: 'イベント別支出（今月）' })).toContainText(`${eventName}: 700円`)

    // 買い物・在庫カードは、小見出しの右にそれぞれの一覧へのリンクを置く(#493)。
    const stockCard = page.locator('.card').filter({ has: page.getByRole('heading', { name: '買い物・在庫', exact: true }) })
    await expect(stockCard.getByRole('link', { name: '買い物リストを見る', exact: true })).toHaveAttribute('href', '/zaiko/shopping')
    await expect(stockCard.getByRole('link', { name: '在庫一覧を見る', exact: true })).toHaveAttribute('href', '/zaiko')
    await expect(stockCard.getByRole('link')).toHaveCount(2)

    await page.goto('/settings/display')
    const inventoryCheckbox = page.getByRole('group', { name: '買い物・在庫' }).getByLabel('在庫リスト')
    await inventoryCheckbox.uncheck()
    await expect(inventoryCheckbox).not.toBeChecked()
    const savedSettings = page.waitForResponse(response => new URL(response.url()).pathname === '/api/user-settings' && response.request().method() === 'PUT')
    // PUT成功より前に開始したGETの後着を、保存後の再取得と取り違えない。
    let saveSucceeded = false
    const markSaved = (response: import('@playwright/test').Response) => {
      if (new URL(response.url()).pathname === '/api/user-settings' && response.request().method() === 'PUT' && response.status() === 200) saveSucceeded = true
    }
    page.on('response', markSaved)
    const reloadedSettings = page.waitForRequest(request => saveSucceeded && new URL(request.url()).pathname === '/api/user-settings' && request.method() === 'GET')
    await page.getByRole('button', { name: '保存' }).click()
    const savedResponse = await savedSettings
    expect(savedResponse.request().postDataJSON().items.stock.inventoryList).toBe(false)
    expect(savedResponse.status()).toBe(200)
    expect((await savedResponse.json()).items.stock.inventoryList).toBe(false)
    const settingsRequest = await reloadedSettings
    const settingsResponse = await settingsRequest.response()
    page.off('response', markSaved)
    if (!settingsResponse) throw new Error('保存後の表示設定GET応答がありません')
    expect(settingsResponse.status()).toBe(200)
    expect((await settingsResponse.json()).items.stock.inventoryList).toBe(false)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('list', { name: '買い物リスト' })).toBeVisible()
    await expect(page.getByRole('list', { name: '在庫リスト' })).toHaveCount(0)
  })
})

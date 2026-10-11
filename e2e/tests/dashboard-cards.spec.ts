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
      await expect(page.getByTestId('inventory-panel').getByRole('row').filter({ hasText: name })).toBeVisible()
    }

    const eventName = '[E2E_TEST] カード期間イベント'
    await page.goto('/events')
    await page.getByRole('button', { name: 'イベントを登録' }).click()
    await page.getByLabel('イベント名').fill(eventName)
    await page.getByLabel('日付').fill(jstToday)
    await page.getByRole('button', { name: '登録', exact: true }).click()
    await expect(page.getByTestId('events-panel').getByRole('row').filter({ hasText: eventName })).toBeVisible()

    await page.goto('/kakeibo')
    await page.getByRole('button', { name: '登録', exact: true }).first().click()
    const modal = page.getByTestId('transaction-modal')
    await modal.getByRole('tab', { name: '支出' }).click()
    await modal.getByLabel('イベント（任意）').selectOption({ label: eventName })
    await modal.getByLabel('金額').fill('700')
    await modal.getByLabel('使用用途（任意）').fill('[E2E_TEST] カード期間支出')
    await modal.getByLabel('日時').fill(jstToday)
    await modal.getByRole('button', { name: '登録', exact: true }).click()
    await expect(modal).toBeHidden()

    await page.goto('/')
    await expect(page.getByText('よく使う品目')).toHaveCount(0)
    const shopping = page.getByRole('list', { name: '買い物リスト' })
    await expect(shopping.getByRole('link', { name: '[E2E_TEST] 牛乳' })).toBeVisible()
    await expect(shopping.getByRole('link', { name: '[E2E_TEST] 米' })).toHaveCount(0)
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

    await shopping.getByRole('link', { name: '[E2E_TEST] 牛乳' }).click()
    await expect(page).toHaveURL(/\/zaiko$/)

    await page.goto('/settings/display')
    await page.getByRole('group', { name: '買い物・在庫' }).getByLabel('在庫リスト').uncheck()
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('list', { name: '買い物リスト' })).toBeVisible()
    await expect(page.getByRole('list', { name: '在庫リスト' })).toHaveCount(0)
  })
})

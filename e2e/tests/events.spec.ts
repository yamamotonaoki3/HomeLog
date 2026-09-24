import { expect, test } from '@playwright/test'
import { setupUserWithHousehold } from './support/flows'

test.describe('F-06 イベント', () => {
  test('イベントを登録すると一覧に表示される', async ({ page }) => {
    await setupUserWithHousehold(page, 'events')
    await page.goto('/events')

    const name = '[E2E_TEST] 誕生日会'
    await page.getByRole('button', { name: 'イベントを登録' }).click()
    await page.getByLabel('イベント名').fill(name)
    await page.getByLabel('日付').fill('2030-01-15')
    await page.getByRole('button', { name: '登録', exact: true }).click()

    const row = page.getByTestId('events-panel').getByRole('row').filter({ hasText: name })
    await expect(row).toContainText('2030-01-15')
  })
})

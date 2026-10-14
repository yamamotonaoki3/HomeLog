import { expect, test } from './console-guard'
import type { Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { setupUserWithHousehold } from './support/flows'

async function checkLayout(page: Page) {
  const first = await page.getByRole('button', { name: '口座を登録', exact: true }).boundingBox()
  const second = await page.getByRole('button', { name: 'カードを登録', exact: true }).boundingBox()
  expect(first).not.toBeNull()
  expect(second).not.toBeNull()
  expect(Math.abs(first!.y - second!.y)).toBeLessThanOrEqual(1)
  expect(first!.x + first!.width).toBeLessThanOrEqual(second!.x)
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth
    const elements = Array.from(document.querySelectorAll('[data-testid="accounts-panel"], .accounts-actions button, .accounts-table, .accounts-table th, .accounts-table td, .accounts-table button, .accounts-card-list li'))
    return {
      page: document.documentElement.scrollWidth > width,
      elements: elements.filter((element) => {
        const box = element.getBoundingClientRect()
        return box.left < 0 || box.right > width + 1 || element.scrollWidth > element.clientWidth + 1
      }).map((element) => element.tagName),
    }
  })
  expect(overflow).toEqual({ page: false, elements: [] })
}

for (const width of [1280, 390, 320]) {
  test(`口座の4列表・登録とチャージ・折り返し ${width}px`, async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    // 登録画面は対象外。対象画面に到達してから検証幅へ切り替える。
    await setupUserWithHousehold(page, `accounts_${width}`)
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/accounts')
    await expect(page.getByText('口座はありません')).toBeVisible()
    await expect(page.getByRole('button', { name: 'カードを登録' })).toBeDisabled()
    await checkLayout(page)
    const name = '[E2E_TEST]' + '長い口座名'.repeat(8)
    await page.getByRole('button', { name: '口座を登録' }).click()
    await page.getByLabel('口座名').fill(name)
    await page.getByLabel('初期残高').fill('123456789')
    await page.getByRole('button', { name: '登録', exact: true }).click()
    const table = page.getByRole('table', { name: '口座一覧' })
    const row = table.getByRole('row').filter({ has: page.getByRole('button', { name, exact: true }) })
    await expect(row.getByRole('cell').nth(2)).toHaveText('123456789円')
    await expect(page.getByRole('button', { name: 'カードを登録' })).toBeEnabled()
    const credit = '[E2E_TEST]' + 'C'.repeat(40)
    const charge = '[E2E_TEST]' + 'チャージ名'.repeat(8)
    for (const [cardName, type] of [[credit, 'credit'], [charge, 'charge']]) {
      await page.getByRole('button', { name: 'カードを登録' }).click()
      await page.getByLabel('カード名').fill(cardName)
      await page.getByLabel('種別').selectOption(type)
      await page.getByRole('button', { name: '登録', exact: true }).click()
      await expect(row.getByRole('cell').nth(3)).toContainText(cardName)
    }
    await expect(row.getByRole('cell').nth(3).getByRole('listitem')).toHaveCount(2)
    await expect(row.getByRole('button', { name: credit })).toHaveCount(0)
    const chargeButton = row.getByRole('button', { name: new RegExp(charge.replace('[E2E_TEST]', '\\[E2E_TEST\\]')) })
    await expect(chargeButton).toHaveText(`${charge}（チャージ型） 残高: 0円`)
    await chargeButton.click()
    await page.getByLabel('チャージ金額').fill('3000')
    await page.getByRole('button', { name: 'チャージする' }).click()
    await expect(row.getByRole('cell').nth(2)).toHaveText('123453789円')
    await expect(chargeButton).toHaveText(`${charge}（チャージ型） 残高: 3000円`)
    await row.getByRole('button', { name, exact: true }).click()
    const history = page.getByTestId('account-transactions-modal')
    await expect(history.getByRole('row').filter({ hasText: '-3000円' }).getByRole('cell').last()).toHaveText('123453789円')
    await history.getByRole('button', { name: '閉じる' }).click()
    for (const [accountName, balance] of [['[E2E_TEST]' + 'A'.repeat(40), '-123456789'], ['[E2E_TEST] ゼロ', '0']]) {
      await page.getByRole('button', { name: '口座を登録' }).click()
      await page.getByLabel('口座名').fill(accountName)
      await page.getByLabel('種別').selectOption('e_money')
      await page.getByLabel('初期残高').fill(balance)
      await page.getByRole('button', { name: '登録', exact: true }).click()
      const other = table.getByRole('row').filter({ has: page.getByRole('button', { name: accountName, exact: true }) })
      await expect(other.getByRole('cell').nth(1)).toHaveText('電子マネー')
      await expect(other.getByRole('cell').nth(2)).toHaveText(`${balance}円`)
      await expect(other.getByRole('cell').nth(3)).toHaveText('なし')
    }
    await expect(table.getByRole('columnheader')).toHaveText(['口座名', '種別', '残高', 'カード'])
    await checkLayout(page)
    const shots = process.env.ACCOUNTS_216_SHOTS
    if (shots) {
      await expect(page.locator('.toast')).not.toHaveClass(/is-visible/)
      await mkdir(shots, { recursive: true })
      await page.screenshot({ path: `${shots}/accounts-${width}.png`, fullPage: true })
    }
  })
}

test.describe('F-11 口座・取引履歴', () => {
  test('口座に紐づけた支出が取引履歴と残高に反映される', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'accounts')
    await page.goto('/accounts')

    const accountName = '[E2E_TEST] 生活口座'
    await page.getByRole('button', { name: '口座を登録' }).click()
    await page.getByLabel('口座名').fill(accountName)
    await page.getByLabel('初期残高').fill('10000')
    await page.getByRole('button', { name: '登録', exact: true }).click()
    const accounts = page.getByTestId('accounts-panel')
    await expect(accounts.getByRole('row').filter({ hasText: accountName }).getByRole('cell').nth(2)).toHaveText('10000円')

    const purpose = '[E2E_TEST] 日用品'
    await page.goto('/kakeibo')
    await page.getByRole('button', { name: '登録', exact: true }).first().click()
    const modal = page.getByTestId('transaction-modal')
    await modal.getByLabel('金額').fill('2500')
    await modal.getByLabel('使用用途（任意）').fill(purpose)
    await modal.getByLabel('口座/カード（任意）').selectOption({ label: accountName })
    await modal.getByRole('button', { name: '登録', exact: true }).click()
    await expect(modal).toBeHidden()

    await page.goto('/accounts')
    await expect(accounts.getByRole('row').filter({ hasText: accountName }).getByRole('cell').nth(2)).toHaveText('7500円')
    await accounts.getByRole('button', { name: accountName }).click()
    const history = page.getByTestId('account-transactions-modal')
    const row = history.getByRole('row').filter({ hasText: purpose })
    await expect(row).toContainText('-2500円')
    await expect(row).toContainText('7500円')
  })
})

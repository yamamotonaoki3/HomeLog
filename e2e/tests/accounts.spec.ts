import { expect, test } from './console-guard'
import type { Locator, Page, Route } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { setupUserWithHousehold } from './support/flows'

async function selectTab(page: Page, name: string) {
  const tab = page.getByRole('tab', { name, exact: true })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  const id = await tab.getAttribute('aria-controls')
  expect(id).toBeTruthy()
  const panel = page.getByRole('tabpanel', { name, exact: true })
  await expect(panel).toHaveAttribute('id', id!)
  return panel
}
async function expandRow(panel: Locator, name: string) {
  const row = panel.getByRole('button', { name: name + 'の詳細', exact: true })
  if (await row.getAttribute('aria-expanded') !== 'true') await row.click()
  await expect(row).toHaveAttribute('aria-expanded', 'true')
  return panel.getByRole('region', { name: name + 'の詳細', exact: true })
}
async function checkLayout(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  for (const element of await page.locator('[data-testid="accounts-panel"]:visible, .accounts-row:visible, .accounts-detail:visible, .modal:visible').all()) {
    expect(await element.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    const box = (await element.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
  }
}
async function checkForm(page: Page, dialog: Locator, initial: string) {
  await expect(dialog.locator(initial)).toBeFocused()
  for (const control of await dialog.locator('input,select,textarea').all()) expect(await control.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
  const count = await dialog.locator('button,input,select,textarea,a[href],[tabindex]').evaluateAll(elements => elements.filter(el => (el as HTMLElement).tabIndex >= 0 && !el.matches(':disabled,input[type="hidden"]') && el.getClientRects().length > 0).length)
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let index = 0; index < count; index++) {
      await page.keyboard.press(key)
      expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
      const rect = await page.evaluate(() => { const b = document.activeElement!.getBoundingClientRect(); return { top: b.top, bottom: b.bottom } })
      expect(rect.top).toBeGreaterThanOrEqual(0)
      expect(rect.bottom).toBeLessThanOrEqual(page.viewportSize()!.height)
    }
    await expect(dialog.locator(initial)).toBeFocused()
  }
  for (const button of await dialog.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await checkLayout(page)
  if (process.env.ACCOUNTS_216_SHOTS) {
    await mkdir(process.env.ACCOUNTS_216_SHOTS, { recursive: true })
    await page.screenshot({ path: process.env.ACCOUNTS_216_SHOTS + '/form-' + initial.slice(1) + '-' + page.viewportSize()!.width + '.png' })
  }
}
async function submitOnce(page: Page, dialog: Locator, submitName: string, path: string, payload: unknown, hold: boolean) {
  let release = () => {}
  let started = false, calls = 0
  const held = new Promise<void>(resolve => { release = resolve })
  const pattern = '**/api/' + path
  const handler = async (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue()
    calls++
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    started = true
    await held
    return route.fulfill({ response })
  }
  if (hold) await page.route(pattern, handler)
  try {
    const request = page.waitForRequest(r => r.method() === 'POST' && new URL(r.url()).pathname === '/api/' + path)
    const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/' + path)
    const submit = dialog.getByRole('button', { name: submitName, exact: true })
    await submit.click()
    expect((await request).postDataJSON()).toEqual(payload)
    if (hold) {
      await expect.poll(() => started).toBe(true)
      await expect(submit).toBeDisabled()
      await expect(dialog.getByRole('button', { name: 'キャンセル', exact: true })).toBeDisabled()
      await page.keyboard.press('Escape')
      await dialog.locator('..').click({ position: { x: 2, y: 2 } })
      await expect(dialog).toBeVisible()
      expect(calls).toBe(1)
      release()
    }
    const saved = await response
    expect(saved.ok()).toBe(true)
    await expect(dialog).toBeHidden()
    return saved
  } finally {
    release()
    if (hold) await page.unroute(pattern, handler)
  }
}

for (const width of [1280, 390, 320]) {
  test.describe(width + 'px 口座・カードUI #424', () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 500 })
    test('2タブのコンパクト表示と登録・チャージ・履歴・残高を維持する', async ({ page, consoleGuard }) => {
      consoleGuard.watch(page)
      await setupUserWithHousehold(page, 'accounts_' + width)
      await page.goto('/accounts')
      const accountTab = page.getByRole('tab', { name: '口座・財布', exact: true })
      const cardTab = page.getByRole('tab', { name: 'カード', exact: true })
      await expect(accountTab).toHaveAttribute('aria-selected', 'true')
      await accountTab.focus()
      await page.keyboard.press('ArrowRight')
      await expect(cardTab).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(cardTab).toHaveAttribute('aria-selected', 'true')
      const emptyCards = page.getByRole('tabpanel', { name: 'カード', exact: true })
      await expect(emptyCards.getByRole('button', { name: 'カードを登録', exact: true })).toBeDisabled()
      await expect(emptyCards).toContainText(/口座.*登録/)
      await emptyCards.getByRole('button', { name: '口座登録へ', exact: true }).click()
      await expect(accountTab).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByRole('button', { name: '口座を登録', exact: true })).toBeFocused()
      await accountTab.focus()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await expect(cardTab).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('Home')
      await page.keyboard.press('Enter')
      const accounts = await selectTab(page, '口座・財布')
      await expect(accounts.locator('.accounts-row')).toHaveCount(0)
      await expect(accounts.getByRole('button', { name: '口座を登録', exact: true })).toBeVisible()
      const name = '[E2E_TEST]' + '長い口座名'.repeat(8)
      const registerAccount = accounts.getByRole('button', { name: '口座を登録', exact: true })
      await registerAccount.click()
      let form = page.getByRole('dialog', { name: '口座を登録', exact: true })
      await expect(form.getByLabel('初期残高')).toHaveValue('0')
      await checkForm(page, form, '#acc-name')
      await page.keyboard.press('Escape')
      await expect(registerAccount).toBeFocused()
      await registerAccount.click()
      await form.locator('..').click({ position: { x: 2, y: 2 } })
      await expect(form).toBeHidden()
      await expect(registerAccount).toBeFocused()
      await registerAccount.click()
      await form.getByLabel('口座名').fill(name)
      await form.getByLabel('初期残高').fill('123456789')
      const accountResponse = await submitOnce(page, form, '登録', 'accounts', { name, type: 'bank', balance: 123456789 }, width === 390)
      const account = await accountResponse.json()
      await expect(registerAccount).toBeFocused()
      const row = accounts.getByRole('button', { name: name + 'の詳細', exact: true })
      await expect(row).toContainText('銀行')
      await expect(row).toHaveAccessibleDescription('銀行 123456789円')
      await expect(row).toContainText(/123,?456,?789円/)
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await expect(row.locator('button,input')).toHaveCount(0)
      const accountDetail = await expandRow(accounts, name)
      await expect(accountDetail).toContainText(/なし|カードはありません/)
      const cards = await selectTab(page, 'カード')
      const credit = '[E2E_TEST]' + 'C'.repeat(40)
      const charge = '[E2E_TEST]' + 'チャージ名'.repeat(8)
      let chargeId = 0
      for (const [cardName, cardType] of [[credit, 'credit'], [charge, 'charge']]) {
        const registerCard = cards.getByRole('button', { name: 'カードを登録', exact: true })
        await registerCard.click()
        form = page.getByRole('dialog', { name: 'カードを登録', exact: true })
        await expect(form.getByLabel('種別')).toHaveValue('credit')
        if (cardType === 'credit') {
          await checkForm(page, form, '#card-account')
          await page.keyboard.press('Escape')
          await expect(registerCard).toBeFocused()
          await registerCard.click()
          await form.locator('..').click({ position: { x: 2, y: 2 } })
          await expect(form).toBeHidden()
          await expect(registerCard).toBeFocused()
          await registerCard.click()
        }
        await form.getByLabel('カード名').fill(cardName)
        await form.getByLabel('種別').selectOption(cardType)
        const response = await submitOnce(page, form, '登録', 'cards', { accountId: account.id, name: cardName, cardType }, width === 390)
        if (cardType === 'charge') chargeId = (await response.json()).id
        await expect(registerCard).toBeFocused()
        const cardRow = cards.getByRole('button', { name: cardName + 'の詳細', exact: true })
        await expect(cardRow).toContainText(name)
        await expect(cardRow).toContainText(cardType === 'credit' ? 'クレジット' : 'チャージ')
        await expect(cardRow).toHaveAccessibleDescription((cardType === 'credit' ? 'クレジットカード' : 'チャージ型カード') + ' ' + name)
        const cardDetail = await expandRow(cards, cardName)
        await expect(cardDetail.getByRole('button', { name: /編集|削除/ })).toHaveCount(0)
        if (cardType === 'credit') await expect(cardDetail.getByRole('button', { name: /にチャージ/ })).toHaveCount(0)
      }
      const chargeDetail = cards.getByRole('region', { name: charge + 'の詳細', exact: true })
      await expect(chargeDetail).toContainText(/残高.*0円/)
      const chargeButton = chargeDetail.getByRole('button', { name: charge + 'にチャージ', exact: true })
      await chargeButton.click()
      form = page.getByRole('dialog', { name: charge + 'にチャージ', exact: true })
      await checkForm(page, form, '#charge-account')
      await page.keyboard.press('Escape')
      await expect(chargeButton).toBeFocused()
      await chargeButton.click()
      await form.locator('..').click({ position: { x: 2, y: 2 } })
      await expect(form).toBeHidden()
      await expect(chargeButton).toBeFocused()
      await chargeButton.click()
      await form.getByLabel('チャージ金額').fill('3000')
      await submitOnce(page, form, 'チャージする', 'cards/' + chargeId + '/charges', { fromAccountId: account.id, amount: 3000 }, width === 390)
      await expect(chargeButton).toBeFocused()
      await expect(chargeDetail).toContainText(/残高.*3,?000円/)
      await checkLayout(page)
      await selectTab(page, '口座・財布')
      await expect(row).toContainText(/123,?453,?789円/)
      const reopened = await expandRow(accounts, name)
      await expect(reopened).toContainText(credit)
      await expect(reopened).toContainText(charge)
      await reopened.getByRole('button', { name: name + 'の取引履歴', exact: true }).click()
      const history = page.getByTestId('account-transactions-modal')
      await expect(history.getByRole('row').filter({ hasText: '-3000円' }).getByRole('cell').last()).toHaveText('123453789円')
      await history.getByRole('button', { name: '閉じる', exact: true }).click()
      for (const [accountName, balance] of [['[E2E_TEST]' + 'A'.repeat(40), '-123456789'], ['[E2E_TEST] ゼロ', '0']]) {
        await registerAccount.click()
        form = page.getByRole('dialog', { name: '口座を登録', exact: true })
        await form.getByLabel('口座名').fill(accountName)
        await form.getByLabel('種別').selectOption('e_money')
        await form.getByLabel('初期残高').fill(balance)
        await submitOnce(page, form, '登録', 'accounts', { name: accountName, type: 'e_money', balance: Number(balance) }, false)
        const other = accounts.getByRole('button', { name: accountName + 'の詳細', exact: true })
        await expect(other).toContainText('電子マネー')
        await expect(other).toContainText(balance === '0' ? '0円' : /-123,?456,?789円/)
        await expect(await expandRow(accounts, accountName)).toContainText(/なし|カードはありません/)
      }
      await checkLayout(page)
      if (process.env.ACCOUNTS_216_SHOTS) {
        await mkdir(process.env.ACCOUNTS_216_SHOTS, { recursive: true })
        await page.screenshot({ path: process.env.ACCOUNTS_216_SHOTS + '/accounts-' + width + '.png', fullPage: true })
        await selectTab(page, 'カード')
        await page.screenshot({ path: process.env.ACCOUNTS_216_SHOTS + '/cards-' + width + '.png', fullPage: true })
      }
    })
  })
}

test('口座に紐づけた支出が取引履歴と残高に反映される', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  await setupUserWithHousehold(page, 'accounts')
  await page.goto('/accounts')
  const accountName = '[E2E_TEST] 生活口座'
  await page.getByRole('button', { name: '口座を登録', exact: true }).click()
  await page.getByLabel('口座名').fill(accountName)
  await page.getByLabel('初期残高').fill('10000')
  await page.getByRole('button', { name: '登録', exact: true }).click()
  const accounts = page.getByRole('tabpanel', { name: '口座・財布', exact: true })
  await expect(accounts.getByRole('button', { name: accountName + 'の詳細', exact: true })).toContainText('10000円')
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
  await expect(accounts.getByRole('button', { name: accountName + 'の詳細', exact: true })).toContainText('7500円')
  const detail = await expandRow(accounts, accountName)
  await detail.getByRole('button', { name: accountName + 'の取引履歴', exact: true }).click()
  const history = page.getByTestId('account-transactions-modal')
  const row = history.getByRole('row').filter({ hasText: purpose })
  await expect(row).toContainText('-2500円')
  await expect(row).toContainText('7500円')
})

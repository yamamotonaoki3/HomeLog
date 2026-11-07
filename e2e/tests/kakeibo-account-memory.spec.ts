import type { Locator, Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './console-guard'
import { login, setupUserWithHousehold } from './support/flows'
import { expectActionTargets44 } from './support/list-row'

test.use({ trace: 'off' })
type Account = { id: number; name: string; balance: number; cards: { id: number }[] }
async function api<T>(page: Page, method: string, path: string, body?: object): Promise<T> {
  const result = await page.evaluate(async ({ method, path, body }) => {
    const response = await fetch('/api/' + path, { method, headers: { Authorization: 'Bearer ' + localStorage.getItem('homelog.accessToken'), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, data: response.status === 204 ? null : await response.json() }
  }, { method, path, body })
  expect(result.status).toBe(method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200)
  return result.data as T
}
async function seed(page: Page, suffix: string) {
  const account = await api<Account>(page, 'POST', 'accounts', { name: '[E2E_TEST] 記憶支出口座' + suffix, type: 'bank', balance: 10000 })
  const other = await api<Account>(page, 'POST', 'accounts', { name: '[E2E_TEST] 記憶収入口座' + suffix, type: 'bank', balance: 500 })
  const card = await api<{ id: number }>(page, 'POST', 'cards', { accountId: account.id, name: '[E2E_TEST] 記憶カード' + suffix, cardType: 'credit' })
  const categories = await api<{ id: number }[]>(page, 'GET', 'kakeibo-categories')
  const incomeCategories = await api<{ id: number }[]>(page, 'GET', 'income-categories')
  return { account, other, card, expenseCategory: categories[0].id, incomeCategory: incomeCategories[0].id }
}
const modalOf = (page: Page) => page.getByTestId('transaction-modal')
const triggerOf = (page: Page) => page.getByRole('button', { name: '収支を登録', exact: true })
const expenseSelect = (modal: Locator) => modal.getByLabel('口座/カード（任意）', { exact: true })
const incomeSelect = (modal: Locator) => modal.getByLabel('入金先口座（必須）', { exact: true })
async function open(page: Page) {
  await triggerOf(page).click()
  await expect(modalOf(page).getByLabel('日時', { exact: true })).toBeFocused()
  return modalOf(page)
}
async function save(page: Page, kind: 'expense' | 'income', text: string, amount: number) {
  const modal = modalOf(page)
  await modal.getByLabel('金額', { exact: true }).fill(String(amount))
  await modal.getByLabel(kind === 'expense' ? '使用用途（任意）' : '収入内容', { exact: true }).fill(text)
  const request = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/' + (kind === 'expense' ? 'expenses' : 'incomes'))
  const response = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/' + (kind === 'expense' ? 'expenses' : 'incomes'))
  await modal.getByRole('button', { name: '登録', exact: true }).click()
  const body = (await request).postDataJSON()
  expect((await response).status()).toBe(201)
  await expect(modal).toBeHidden()
  await expect(triggerOf(page)).toBeFocused()
  return body
}
async function storedSelections(page: Page) {
  return page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('homelog.lastTransactionAccount.v1:')).map(key => ({ kind: key.endsWith(':expense') ? 'expense' : 'income', value: JSON.parse(localStorage.getItem(key)!) as { selection: string } })).sort((left, right) => left.kind.localeCompare(right.kind)))
}
async function shot(page: Page, width: number, label: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  const directory = process.env.KAKEIBO_MEMORY_SCREENSHOT_DIR
  if (directory) { await mkdir(directory, { recursive: true }); await page.screenshot({ path: join(directory, label + '-' + width + '.png'), fullPage: true }) }
}
for (const width of [1280, 390, 320]) {
  test.describe(width + 'px 口座記憶 #422', () => {
    test.use({ viewport: { width, height: 844 } })
    test('成功した口座とカードを種別別に復元し取消・編集・明示解除と全bodyを維持する', async ({ page, consoleGuard }) => {
      consoleGuard.watch(page)
      await setupUserWithHousehold(page, 'ledger_memory_' + width)
      const fixture = await seed(page, String(width))
      const date = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
      await page.goto('/kakeibo')
      const modal = await open(page)
      const expense = expenseSelect(modal), income = incomeSelect(modal)
      await expect(expense).toHaveValue('')
      await expectActionTargets44(modal)
      for (const control of await modal.locator('input:visible,select:visible,textarea:visible').all()) expect(await control.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
      const accountText = '[E2E_TEST] 記憶口座支出' + width
      await expense.selectOption('account:' + fixture.account.id)
      expect(await save(page, 'expense', accountText, 100)).toEqual({ expenseDate: date, amount: 100, purpose: accountText, categoryId: fixture.expenseCategory, memo: null, includeInHouseholdTotal: false, accountId: fixture.account.id, cardId: null, eventId: null })
      await open(page)
      await expect(expense).toHaveValue('account:' + fixture.account.id)
      await expense.selectOption('card:' + fixture.card.id)
      await modal.getByRole('button', { name: 'キャンセル', exact: true }).click()
      await expect(triggerOf(page)).toBeFocused()
      await open(page)
      await expect(expense).toHaveValue('account:' + fixture.account.id)
      await expense.selectOption('card:' + fixture.card.id)
      const cardText = '[E2E_TEST] 記憶カード支出' + width
      expect(await save(page, 'expense', cardText, 50)).toEqual({ expenseDate: date, amount: 50, purpose: cardText, categoryId: fixture.expenseCategory, memo: null, includeInHouseholdTotal: false, accountId: null, cardId: fixture.card.id, eventId: null })
      await open(page)
      await expect(expense).toHaveValue('card:' + fixture.card.id)
      await modal.getByRole('tab', { name: '収入', exact: true }).click()
      await expect(income).toHaveValue('')
      await income.selectOption(String(fixture.other.id))
      const incomeText = '[E2E_TEST] 記憶収入' + width
      expect(await save(page, 'income', incomeText, 300)).toEqual({ incomeDate: date, amount: 300, content: incomeText, categoryId: fixture.incomeCategory, accountId: fixture.other.id, memo: null })
      await open(page)
      await expect(expense).toHaveValue('card:' + fixture.card.id)
      await modal.getByRole('tab', { name: '収入', exact: true }).click()
      await expect(income).toHaveValue(String(fixture.other.id))
      await modal.getByRole('tab', { name: '支出', exact: true }).click()
      await expect(expense).toHaveValue('card:' + fixture.card.id)
      await shot(page, width, 'remembered-card')
      await page.keyboard.press('Escape')
      await expect(modal).toBeHidden()
      await expect(triggerOf(page)).toBeFocused()
      await page.getByRole('button', { name: '支出：' + accountText + 'の詳細', exact: true }).click()
      const detail = page.getByTestId('transaction-detail-modal')
      await detail.getByRole('button', { name: '編集', exact: true }).click()
      await expect(expense).toHaveValue('account:' + fixture.account.id)
      await modal.getByRole('button', { name: 'キャンセル', exact: true }).click()
      await detail.getByRole('button', { name: '閉じる', exact: true }).click()
      await open(page)
      await expect(expense).toHaveValue('card:' + fixture.card.id)
      await expense.selectOption('')
      const noneText = '[E2E_TEST] 明示未選択支出' + width
      expect(await save(page, 'expense', noneText, 25)).toEqual({ expenseDate: date, amount: 25, purpose: noneText, categoryId: fixture.expenseCategory, memo: null, includeInHouseholdTotal: false, accountId: null, cardId: null, eventId: null })
      await open(page)
      await expect(expense).toHaveValue('')
      await modal.getByRole('tab', { name: '収入', exact: true }).click()
      await expect(income).toHaveValue(String(fixture.other.id))
      await shot(page, width, 'remembered-income')
      await modal.getByRole('button', { name: 'キャンセル', exact: true }).click()
      const accounts = await api<Account[]>(page, 'GET', 'accounts')
      expect(accounts.find(account => account.id === fixture.account.id)?.balance).toBe(9850)
      expect(accounts.find(account => account.id === fixture.other.id)?.balance).toBe(800)
      expect(await storedSelections(page)).toEqual([{ kind: 'expense', value: { selection: '' } }, { kind: 'income', value: { selection: String(fixture.other.id) } }])
    })
  })
}

test.describe('390px 同browser利用者分離 #422', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('AとBの口座記憶を分け、A再loginで本人の成功選択だけを復元する', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    const a = await setupUserWithHousehold(page, 'ledger_memory_actor_a')
    const aFixture = await seed(page, 'actor_a')
    await page.goto('/kakeibo')
    const modal = await open(page)
    await expenseSelect(modal).selectOption('account:' + aFixture.account.id)
    await save(page, 'expense', '[E2E_TEST] A成功記憶', 10)
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    const b = await setupUserWithHousehold(page, 'ledger_memory_actor_b')
    const bFixture = await seed(page, 'actor_b')
    await page.goto('/kakeibo')
    await open(page)
    await expect(expenseSelect(modal)).toHaveValue('')
    await expect(expenseSelect(modal).getByRole('option', { name: aFixture.account.name, exact: true })).toHaveCount(0)
    await expenseSelect(modal).selectOption('account:' + bFixture.account.id)
    await save(page, 'expense', '[E2E_TEST] B成功記憶', 20)
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.goto('/kakeibo')
    await expect(page).toHaveURL(/\/login$/)
    await login(page, a)
    await expect(page).toHaveURL(/\/kakeibo$/)
    await open(page)
    await expect(expenseSelect(modal)).toHaveValue('account:' + aFixture.account.id)
    await expect(expenseSelect(modal).getByRole('option', { name: bFixture.account.name, exact: true })).toHaveCount(0)
    await modal.getByRole('button', { name: 'キャンセル', exact: true }).click()
    expect((await api<Account[]>(page, 'GET', 'accounts')).find(account => account.id === aFixture.account.id)?.balance).toBe(9990)
    expect(await storedSelections(page)).toEqual(expect.arrayContaining([{ kind: 'expense', value: { selection: 'account:' + aFixture.account.id } }, { kind: 'expense', value: { selection: 'account:' + bFixture.account.id } }]))
    expect(await storedSelections(page)).toHaveLength(2)
    expect(b.email.endsWith('@example.com')).toBe(true)
  })
})


test.describe('390px 未指定の編集境界 #422', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('記憶したカードを口座無し明細のメモ編集へ混入せず残高を変えない', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'ledger_memory_null_edit')
    const fixture = await seed(page, 'null_edit')
    const date = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
    const purpose = '[E2E_TEST] 口座なし既存明細'
    const original = await api<{ id: number }>(page, 'POST', 'expenses', { expenseDate: date, amount: 40, purpose, categoryId: fixture.expenseCategory })
    await page.goto('/kakeibo')
    const modal = await open(page)
    await expenseSelect(modal).selectOption('card:' + fixture.card.id)
    const savedCard = await save(page, 'expense', '[E2E_TEST] カード記憶準備', 50)
    expect(savedCard).toMatchObject({ accountId: null, cardId: fixture.card.id, amount: 50 })
    const before = (await api<Account[]>(page, 'GET', 'accounts')).map(({ id, balance }) => ({ id, balance }))
    expect(before.find(account => account.id === fixture.account.id)?.balance).toBe(9950)
    await page.getByRole('button', { name: '支出：' + purpose + 'の詳細', exact: true }).click()
    const detail = page.getByTestId('transaction-detail-modal')
    await detail.getByRole('button', { name: '編集', exact: true }).click()
    await expect(expenseSelect(modal)).toHaveValue('')
    await modal.getByRole('button', { name: 'その他の設定', exact: true }).click()
    const memo = '[E2E_TEST] メモだけ編集'
    await modal.getByLabel('メモ', { exact: true }).fill(memo)
    const request = page.waitForRequest(request => request.method() === 'PUT' && new URL(request.url()).pathname === '/api/expenses/' + original.id)
    const response = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === '/api/expenses/' + original.id)
    await modal.getByRole('button', { name: '保存', exact: true }).click()
    expect((await request).postDataJSON()).toEqual({ expenseDate: date, amount: 40, purpose, categoryId: fixture.expenseCategory, memo, includeInHouseholdTotal: false, accountId: null, cardId: null, eventId: null })
    expect((await response).status()).toBe(200)
    await expect(modal).toBeHidden()
    expect((await api<Account[]>(page, 'GET', 'accounts')).map(({ id, balance }) => ({ id, balance }))).toEqual(before)
    const expenses = await api<{ id: number; accountId: number | null; cardId: number | null; memo: string }[]>(page, 'GET', 'expenses')
    expect(expenses.find(expense => expense.id === original.id)).toMatchObject({ accountId: null, cardId: null, memo })
    expect(await storedSelections(page)).toEqual([{ kind: 'expense', value: { selection: '' } }])
  })
})


test.describe('390px 本人情報loading送信境界 #422', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('実auth/meの配送を待つ間はopen可能でPOST0、ready後の一回保存だけを記憶する', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'ledger_memory_loading')
    const fixture = await seed(page, 'loading')
    let release!: () => void, entered!: () => void, completed!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const arrived = new Promise<void>(resolve => { entered = resolve })
    const finished = new Promise<void>(resolve => { completed = resolve })
    let intercepted = false, posts = 0
    page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/expenses') posts++ })
    await page.route('**/api/auth/me', async route => {
      if (intercepted) { await route.continue(); return }
      intercepted = true
      try {
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        entered()
        await gate
        await route.fulfill({ response })
      } finally { completed() }
    })
    try {
      await page.goto('/kakeibo')
      await arrived
      const modal = await open(page)
      const submit = modal.getByRole('button', { name: '登録', exact: true })
      await modal.getByLabel('金額', { exact: true }).fill('1000')
      await expect(submit).toBeDisabled()
      await modal.locator('form').dispatchEvent('submit')
      expect(await api<unknown[]>(page, 'GET', 'expenses')).toEqual([])
      expect(posts).toBe(0)
      await shot(page, 390, 'identity-loading')
      release()
      await finished
      await expect(submit).toBeEnabled()
      await page.keyboard.press('Escape')
      await expect(modal).toBeHidden()
      await expect(triggerOf(page)).toBeFocused()
      await open(page)
      await expenseSelect(modal).selectOption('account:' + fixture.account.id)
      const purpose = '[E2E_TEST] loading確定後一回保存'
      const body = await save(page, 'expense', purpose, 1000)
      expect(body).toMatchObject({ amount: 1000, purpose, accountId: fixture.account.id, cardId: null })
      expect(posts).toBe(1)
      const expenses = await api<{ purpose: string }[]>(page, 'GET', 'expenses')
      expect(expenses.filter(expense => expense.purpose === purpose)).toHaveLength(1)
      expect((await api<Account[]>(page, 'GET', 'accounts')).find(account => account.id === fixture.account.id)?.balance).toBe(9000)
      expect(await storedSelections(page)).toEqual([{ kind: 'expense', value: { selection: 'account:' + fixture.account.id } }])
    } finally {
      release()
      if (intercepted) await finished
      await page.unroute('**/api/auth/me')
    }
  })
})

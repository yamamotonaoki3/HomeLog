import { expect, type Page } from '@playwright/test'
import { newUser, type E2EUser } from './test-data'

export async function register(page: Page, user: E2EUser): Promise<void> {
  await page.goto('/register')
  await page.getByLabel('メールアドレス').fill(user.email)
  await page.locator('#reg-password').fill(user.password)
  await page.locator('#reg-password-confirm').fill(user.password)
  await page.getByLabel('表示名').fill(user.displayName)
  await page.getByRole('button', { name: '登録する' }).click()
  await expect(page).toHaveURL(/\/household$/)
}

export async function login(page: Page, user: E2EUser): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('メールアドレス').fill(user.email)
  await page.locator('#login-password').fill(user.password)
  await page.getByRole('button', { name: 'ログイン' }).click()
}

export async function createHousehold(page: Page, name: string): Promise<void> {
  await page.getByLabel('世帯グループ名').fill(name)
  await page.getByRole('button', { name: '作成する' }).click()
  await expect(page).toHaveURL(/\/$/)
}

/** 新規ユーザーを登録し、世帯を作成してダッシュボードに到達した状態にする */
export async function setupUserWithHousehold(page: Page, label: string): Promise<E2EUser> {
  const user = newUser(label)
  await register(page, user)
  await createHousehold(page, `e2euser_household_${label}`)
  return user
}

export async function getInviteCode(page: Page): Promise<string> {
  await page.goto('/household/settings')
  const code = (await page.locator('p', { hasText: '招待コード' }).locator('strong').textContent())?.trim()
  expect(code).toBeTruthy()
  return code!
}

export async function joinHousehold(page: Page, inviteCode: string): Promise<void> {
  await page.getByLabel('招待コード').fill(inviteCode)
  await page.getByRole('button', { name: '参加する' }).click()
  await expect(page).toHaveURL(/\/$/)
}

/** 表示検証専用の収入データを実APIで作る。UI登録そのものはaddTransactionで検証する。 */
export async function addIncomeViaApi(page: Page, amount: number, content: string, date?: string): Promise<void> {
  const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
  const headers = { Authorization: `Bearer ${token}` }
  const accountResponse = await page.request.post('/api/accounts', { headers, data: { name: '[E2E_TEST] income account', type: 'bank', balance: 0 } })
  expect(accountResponse.status()).toBe(201)
  const account = await accountResponse.json()
  const categoryResponse = await page.request.get('/api/income-categories', { headers })
  expect(categoryResponse.ok()).toBe(true)
  const categories = await categoryResponse.json()
  const response = await page.request.post('/api/incomes', { headers, data: { incomeDate: date ?? new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), amount, content, categoryId: categories[0].id, accountId: account.id } })
  expect(response.status()).toBe(201)
  await page.reload()
}

/** 家計簿画面で支出/収入を1件登録する。splitWith を渡すと、その表示名のメンバーと割り勘(割合指定)にする */
export async function addTransaction(
  page: Page,
  kind: '支出' | '収入',
  amount: number,
  text: string,
  options: { date?: string; splitWith?: string; splitRatio?: number; accountId?: number } = {},
): Promise<void> {
  await page.getByRole('button', { name: '登録', exact: true }).first().click()
  const modal = page.getByTestId('transaction-modal')
  await modal.getByRole('tab', { name: kind }).click()
  await modal.getByLabel('金額').fill(String(amount))
  await modal.getByLabel(kind === '支出' ? '使用用途（任意）' : '収入内容').fill(text)
  if (kind === '収入') {
    if (options.accountId === undefined) throw new Error('収入登録には明示的なaccountIdが必要です')
    await modal.getByLabel('入金先口座（必須）').selectOption(String(options.accountId))
  }
  if (options.date) {
    await modal.getByLabel('日時').fill(options.date)
  }
  if (options.splitWith) {
    await modal.getByLabel('割り勘する').check()
    if ((await modal.getByLabel('世帯メンバー').count()) === 0) {
      await modal.getByRole('button', { name: '相手を追加' }).click()
    }
    await modal.getByLabel('世帯メンバー').selectOption({ label: options.splitWith })
    await modal.getByLabel('負担割合（％）').fill(String(options.splitRatio ?? 50))
  }
  await modal.getByRole('button', { name: '登録', exact: true }).click()
  await expect(modal).toBeHidden()
}

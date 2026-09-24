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

/** 家計簿画面で支出/収入を1件登録する。splitWith を渡すと、その表示名のメンバーと割り勘(割合指定)にする */
export async function addTransaction(
  page: Page,
  kind: '支出' | '収入',
  amount: number,
  text: string,
  options: { splitWith?: string; splitRatio?: number } = {},
): Promise<void> {
  await page.getByRole('button', { name: '登録', exact: true }).first().click()
  const modal = page.getByTestId('transaction-modal')
  await modal.getByRole('tab', { name: kind }).click()
  await modal.getByLabel('金額').fill(String(amount))
  await modal.getByLabel(kind === '支出' ? '使用用途（任意）' : '収入内容').fill(text)
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

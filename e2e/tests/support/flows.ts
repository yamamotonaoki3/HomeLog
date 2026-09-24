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

import { expect, test } from '@playwright/test'
import { createHousehold, login, register } from './support/flows'
import { newUser } from './support/test-data'

test.describe('F-01 認証', () => {
  test('新規登録 → ログアウト → ログインできる', async ({ page }) => {
    const user = newUser('auth')
    await register(page, user)
    await createHousehold(page, 'e2euser_household_auth')

    await page.getByRole('button', { name: 'ログアウト' }).click()
    await expect(page).toHaveURL(/\/login/)

    await login(page, user)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('button', { name: 'ログアウト' })).toBeVisible()
  })

  test('確認用パスワードが一致しないと登録できない', async ({ page }) => {
    const user = newUser('mismatch')
    await page.goto('/register')
    await page.getByLabel('メールアドレス').fill(user.email)
    await page.locator('#reg-password').fill(user.password)
    await page.locator('#reg-password-confirm').fill(`${user.password}x`)
    await page.getByLabel('表示名').fill(user.displayName)
    await page.getByRole('button', { name: '登録する' }).click()

    await expect(page.getByText('パスワードが一致しません')).toBeVisible()
    await expect(page).toHaveURL(/\/register$/)
  })

  test('誤ったパスワードではログインできない', async ({ page }) => {
    const user = newUser('wrongpw')
    await register(page, user)
    await page.context().clearCookies()
    await page.evaluate(() => localStorage.clear())

    await login(page, { ...user, password: 'WrongPass999!' })
    await expect(page).toHaveURL(/\/login/)
    await expect(page.locator('.error')).not.toBeEmpty()
  })

  test('未ログインで保護ページを開くとログイン画面へリダイレクトされる', async ({ page }) => {
    await page.goto('/kakeibo')
    await expect(page).toHaveURL(/\/login/)
  })
})

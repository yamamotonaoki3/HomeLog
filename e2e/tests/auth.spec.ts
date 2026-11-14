import { openAccountMenu } from './support/flows'
import { expect, test } from './console-guard'
import { createHousehold, login, register } from './support/flows'
import { newUser } from './support/test-data'

test.describe('F-01 認証', () => {
  test('新規登録 → ログアウト → ログインできる', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    const user = newUser('auth')
    await register(page, user)
    await createHousehold(page, 'e2euser_household_auth')

    await (await openAccountMenu(page)).getByRole('button', { name: 'ログアウト', exact: true }).click()
    await expect(page).toHaveURL(/\/login/)

    await login(page, user)
    await expect(page).toHaveURL(/\/$/)
    await expect((await openAccountMenu(page)).getByRole('button', { name: 'ログアウト', exact: true })).toBeVisible()
  })

  test('デモ環境でなければログイン画面にデモのボタンを出さない (#534)', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    const availability = page.waitForResponse((response) => response.url().endsWith('/api/demo'))
    await page.goto('/login')
    expect(await (await availability).json()).toEqual({ enabled: false })
    await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /デモを試す/ })).toHaveCount(0)
    await expect(page.getByText('架空の2人の世帯で、24時間お試しできます')).toHaveCount(0)
  })

  test('確認用パスワードが一致しないと登録できない', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
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

  test('誤ったパスワードではログインできない', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    const user = newUser('wrongpw')
    await register(page, user)
    await page.context().clearCookies()
    await page.evaluate(() => localStorage.clear())

    consoleGuard.allow({ url: /\/api\/auth\/login$/, message: /401 \(Unauthorized\)/ })
    await login(page, { ...user, password: 'WrongPass999!' })
    await expect(page).toHaveURL(/\/login/)
    await expect(page.locator('.error')).not.toBeEmpty()
  })

  test('未ログインで保護ページを開くとログイン画面へリダイレクトされる', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await page.goto('/kakeibo')
    await expect(page).toHaveURL(/\/login/)
  })
})

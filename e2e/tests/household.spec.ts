import { expect, test } from '@playwright/test'
import { register, setupUserWithHousehold } from './support/flows'
import { newUser } from './support/test-data'

test.describe('F-02 世帯', () => {
  test('ユーザーAが作成した世帯に、ユーザーBが招待コードで参加できる', async ({ browser, baseURL }) => {
    const contextA = await browser.newContext({ baseURL })
    const contextB = await browser.newContext({ baseURL })
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    const userA = await setupUserWithHousehold(pageA, 'owner')
    await pageA.goto('/household/settings')
    const inviteCode = (await pageA.locator('p', { hasText: '招待コード' }).locator('strong').textContent())?.trim()
    expect(inviteCode).toBeTruthy()

    const userB = newUser('member')
    await register(pageB, userB)
    await pageB.getByLabel('招待コード').fill(inviteCode!)
    await pageB.getByRole('button', { name: '参加する' }).click()
    await expect(pageB).toHaveURL(/\/$/)

    // 双方の世帯設定にメンバーとして表示される
    await pageB.goto('/household/settings')
    await expect(pageB.getByRole('listitem').filter({ hasText: userA.displayName })).toBeVisible()
    await pageA.reload()
    await expect(pageA.getByRole('listitem').filter({ hasText: userB.displayName })).toBeVisible()

    await contextA.close()
    await contextB.close()
  })

  test('存在しない招待コードでは参加できない', async ({ page }) => {
    await register(page, newUser('badcode'))
    await page.getByLabel('招待コード').fill('ZZZZZZZZ')
    await page.getByRole('button', { name: '参加する' }).click()
    await expect(page).toHaveURL(/\/household$/)
    await expect(page.locator('.error')).not.toBeEmpty()
  })
})

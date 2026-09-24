import { expect, test } from '@playwright/test'
import { addTransaction, getInviteCode, joinHousehold, register, setupUserWithHousehold } from './support/flows'
import { newUser } from './support/test-data'

test.describe('F-04 割り勘・精算', () => {
  test('A が割り勘登録 → B が支払報告 → A が受領確認で精算済みになる', async ({ browser, baseURL }) => {
    const contextA = await browser.newContext({ baseURL })
    const contextB = await browser.newContext({ baseURL })
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    await setupUserWithHousehold(pageA, 'warikan_payer')
    const inviteCode = await getInviteCode(pageA)
    const userB = newUser('warikan_debtor')
    await register(pageB, userB)
    await joinHousehold(pageB, inviteCode)

    const purpose = '[E2E_TEST] 夕食の割り勘'
    await pageA.goto('/kakeibo')
    await addTransaction(pageA, '支出', 3000, purpose, { splitWith: userB.displayName, splitRatio: 50 })

    // A(立替者)側：請求対象として表示される
    await pageA.goto('/warikan')
    const rowA = pageA.getByRole('row').filter({ hasText: purpose })
    await expect(rowA).toContainText('1500円')
    await expect(rowA).toContainText('未請求')

    // B(負担者)側：支払を報告する
    await pageB.goto('/warikan')
    const rowB = pageB.getByRole('row').filter({ hasText: purpose })
    await rowB.getByRole('button', { name: '支払う' }).click()
    await pageB.getByTestId('settlement-account-modal').getByRole('button', { name: '支払った' }).click()
    await expect(rowB).toContainText('受領確認待ち')

    // A 側：受領を確定すると精算済みになる
    await pageA.reload()
    await rowA.getByRole('button', { name: '受け取りました' }).click()
    await pageA.getByTestId('settlement-account-modal').getByRole('button', { name: '受け取りを確定' }).click()
    await expect(rowA).toContainText('精算済み')

    await contextA.close()
    await contextB.close()
  })
})

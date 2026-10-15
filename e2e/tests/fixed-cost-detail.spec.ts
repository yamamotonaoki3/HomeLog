import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './console-guard'
import { setupUserWithHousehold, getInviteCode, register, joinHousehold } from './support/flows'
import { newUser } from './support/test-data'

for (const width of [1280, 390, 320]) {
  test(`固定費4列・詳細と編集・削除 ${width}px`, async ({ browser, baseURL, consoleGuard }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, hasTouch: width < 400 })
    try {
      const page = await context.newPage()
      consoleGuard.watch(page)
      await setupUserWithHousehold(page, `fixed_detail_${width}`)
      const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
      const headers = { Authorization: `Bearer ${token}` }
      const accountName = '[E2E_TEST]' + '長い口座名'.repeat(8)
      const accountResponse = await page.request.post('/api/accounts', { headers, data: { name: accountName, type: 'bank', balance: 0 } })
      expect(accountResponse.status()).toBe(201)
      const accountId = (await accountResponse.json()).id
      const name = '[E2E_TEST]' + '長い固定費名'.repeat(6)
      const response = await page.request.post('/api/fixed-costs', { headers, data: { name, amount: 9999999999, paymentDay: 31, personal: false, includeInHouseholdTotal: true, accountId, cardId: null, splitInputType: null, splits: [] } })
      expect(response.status()).toBe(201)
      await page.goto('/fixed-costs')
      const row = page.getByRole('button', { name: `${name}の詳細`, exact: true })
      const detail = page.getByRole('dialog', { name: '固定費詳細' })
      const close = detail.getByRole('button', { name: '閉じる' })
      const press = async (locator: typeof row) => width < 400 ? locator.tap() : locator.click()
      const screenshot = async (label: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
        for (const element of await page.locator('.fixed-cost-grid, .fixed-cost-grid > span, .fixed-cost-modal, .fixed-cost-modal dd, .fixed-cost-modal form').all()) {
          expect(await element.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
          const box = (await element.boundingBox())!
          expect(box.x).toBeGreaterThanOrEqual(0)
          expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
        }
        if (process.env.FIXED_COST_SCREENSHOT_DIR) {
          await mkdir(process.env.FIXED_COST_SCREENSHOT_DIR, { recursive: true })
          await page.screenshot({ path: join(process.env.FIXED_COST_SCREENSHOT_DIR, `fixed-cost-${label}-${width}.png`), fullPage: true })
        }
      }
      await expect(row).toBeVisible()
      await expect(row.locator('span')).toHaveCount(4)
      await expect(row.locator('button,input')).toHaveCount(0)
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await screenshot('list')
      for (const index of [0, 1, 2, 3]) {
        await press(row.locator('span').nth(index))
        await expect(detail).toBeVisible()
        await close.click()
        await expect(row).toBeFocused()
      }
      await row.click({ position: { x: 3, y: 3 } })
      await expect(close).toBeFocused()
      await expect(detail.getByText('9999999999円', { exact: true })).toBeVisible()
      await expect(detail.getByText(accountName, { exact: true })).toBeVisible()
      await expect(detail.getByText('含める', { exact: true })).toBeVisible()
      await expect(detail.getByText('世帯共有', { exact: true })).toBeVisible()
      await expect(detail.getByText('なし', { exact: true })).toBeVisible()
      expect(await detail.evaluate((el) => el.scrollTop)).toBe(0)
      await page.keyboard.press('Tab')
      await expect(detail.getByRole('button', { name: '編集' })).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(close).toBeFocused()
      await screenshot('detail')
      await page.keyboard.press('Escape')
      for (const key of ['Enter', 'Space']) {
        await page.keyboard.press(key)
        await expect(detail).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(row).toBeFocused()
      }
      await press(row)
      await press(detail.getByRole('button', { name: '編集' }))
      const edit = page.getByRole('dialog', { name: '固定費を編集' })
      await expect(edit.getByLabel('固定費名', { exact: true })).toBeFocused()
      await screenshot('edit')
      await edit.getByRole('button', { name: 'キャンセル' }).click()
      await expect(detail).toBeVisible()
      await detail.getByRole('button', { name: '編集' }).click()
      await edit.getByLabel('金額', { exact: true }).fill('85000')
      await edit.getByRole('button', { name: '更新', exact: true }).click()
      await expect(detail.getByText('85000円', { exact: true })).toBeVisible()
      await detail.getByRole('button', { name: '削除', exact: true }).click()
      const confirmation = page.getByRole('dialog', { name: '固定費を削除しますか？' })
      await expect(confirmation.getByRole('button', { name: 'キャンセル' })).toBeFocused()
      await screenshot('delete')
      await confirmation.getByRole('button', { name: 'キャンセル' }).click()
      await expect(detail).toBeVisible()
      await detail.getByRole('button', { name: '削除', exact: true }).click()
      await confirmation.getByRole('button', { name: '削除する' }).click()
      await expect(row).toHaveCount(0)
      const register = page.getByRole('button', { name: '固定費を登録', exact: true })
      await expect(register).toBeFocused()
      await register.click()
      await screenshot('register')
      await page.keyboard.press('Escape')
      await expect(register).toBeFocused()
    } finally { await context.close() }
  })
}

test('同じ世帯の他者は共有固定費だけ閲覧でき、引き落とし元・割り勘・操作は非公開', async ({ page, browser, baseURL, consoleGuard }) => {
  consoleGuard.watch(page)
  await setupUserWithHousehold(page, 'fixed_detail_owner')
  const invite = await getInviteCode(page)
  const context = await browser.newContext({ baseURL })
  try {
    const other = await context.newPage()
    consoleGuard.watch(other)
    const member = newUser('fixed_detail_member')
    await register(other, member)
    await joinHousehold(other, invite)
    const headers = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('homelog.accessToken'))}` }
    const me = await page.request.get('/api/households/me', { headers })
    expect(me.ok()).toBe(true)
    const debtor = (await me.json()).members.find((value: { displayName: string }) => value.displayName === member.displayName)
    expect(debtor).toBeTruthy()
    const account = await page.request.post('/api/accounts', { headers, data: { name: '[E2E_TEST]本人専用口座', type: 'bank', balance: 0 } })
    expect(account.status()).toBe(201)
    const payload = { amount: 80000, paymentDay: 27, includeInHouseholdTotal: true, accountId: (await account.json()).id, cardId: null, splitInputType: 'amount', splits: [{ debtorUserId: debtor.userId, amountDue: 40000 }] }
    for (const personal of [false, true]) {
      const result = await page.request.post('/api/fixed-costs', { headers, data: { ...payload, personal, name: personal ? '[E2E_TEST]個人固定費' : '[E2E_TEST]共有固定費' } })
      expect(result.status()).toBe(201)
    }
    await page.goto('/fixed-costs')
    await page.getByRole('button', { name: '[E2E_TEST]共有固定費の詳細', exact: true }).click()
    const ownerDetail = page.getByRole('dialog', { name: '固定費詳細' })
    await expect(ownerDetail).toContainText('金額入力')
    await expect(ownerDetail).toContainText(member.displayName)
    await expect(ownerDetail).toContainText('50% / 40000円')
    await expect(ownerDetail).toContainText('[E2E_TEST]本人専用口座')
    await other.goto('/fixed-costs')
    await expect(other.getByRole('button', { name: '[E2E_TEST]個人固定費の詳細', exact: true })).toHaveCount(0)
    const row = other.getByRole('button', { name: '[E2E_TEST]共有固定費の詳細', exact: true })
    await expect(row).toContainText('非公開')
    await row.click()
    const detail = other.getByRole('dialog', { name: '固定費詳細' })
    await expect(detail.getByText('非公開', { exact: true })).toHaveCount(2)
    await expect(detail.getByRole('button', { name: '編集' })).toHaveCount(0)
    await expect(detail.getByRole('button', { name: '削除', exact: true })).toHaveCount(0)
    await expect(detail).not.toContainText('[E2E_TEST]本人専用口座')
    await expect(detail).not.toContainText('40000円')
  } finally { await context.close() }
})

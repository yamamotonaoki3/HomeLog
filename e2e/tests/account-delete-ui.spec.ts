import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

for (const width of [1280, 390, 320]) {
  test(`履歴のある口座を履歴モーダルから削除でき、履歴は残り一覧と入力の選択肢から外れる ${width}px (#371)`, async ({ page, consoleGuard }) => {
    await page.setViewportSize({ width, height: 844 })
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, `account_delete_ui_${width}`)
    const headers = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('homelog.accessToken'))}` }
    const targetRes = await page.request.post('/api/accounts', { headers, data: { name: '[E2E_TEST] 削除する口座', type: 'bank', balance: 5000 } })
    const keepRes = await page.request.post('/api/accounts', { headers, data: { name: '[E2E_TEST] 残す口座', type: 'bank', balance: 3000 } })
    expect(targetRes.status()).toBe(201)
    expect(keepRes.status()).toBe(201)
    const target = await targetRes.json()
    const categories = await (await page.request.get('/api/kakeibo-categories', { headers })).json()
    const expenseDate = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
    const expense = await page.request.post('/api/expenses', {
      headers,
      data: { expenseDate, amount: 700, purpose: '[E2E_TEST] 履歴の支出', categoryId: categories[0].id, accountId: target.id },
    })
    expect(expense.status()).toBe(201)

    await page.goto('/accounts')
    const table = page.getByRole('table', { name: '口座一覧' })
    await table.getByRole('button', { name: '[E2E_TEST] 削除する口座' }).click()
    const dialog = page.getByRole('dialog', { name: /取引履歴/ })
    await expect(dialog.getByText('[E2E_TEST] 履歴の支出')).toBeVisible()

    // 取消では何も削除されない
    await dialog.getByRole('button', { name: '口座を削除' }).click()
    await expect(dialog.getByText(/取引履歴は残ります/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'キャンセル' })).toBeFocused()
    await dialog.getByRole('button', { name: 'キャンセル' }).click()
    await expect(dialog.getByRole('button', { name: '口座を削除' })).toBeFocused()
    expect(await (await page.request.get('/api/accounts', { headers })).json()).toHaveLength(2)

    // Tab は確認中もモーダル内を巡回する
    await dialog.getByRole('button', { name: '口座を削除' }).click()
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true)
    }

    // 画面の収まり
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    const box = await dialog.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    const shotDir = process.env.ACCOUNT_DELETE_SCREENSHOT_DIR
    if (shotDir) {
      await mkdir(shotDir, { recursive: true })
      await page.screenshot({ path: join(shotDir, `account-delete-${width}.png`) })
    }

    await dialog.getByRole('button', { name: '削除する' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('status')).toContainText('口座を削除しました')
    await expect(table.getByRole('button', { name: '[E2E_TEST] 削除する口座' })).toHaveCount(0)
    await expect(table.getByRole('button', { name: '[E2E_TEST] 残す口座' })).toBeVisible()

    // 履歴は保持され、削除口座は新規入力に使えない
    const expenses = await (await page.request.get('/api/expenses', { headers })).json()
    expect(JSON.stringify(expenses)).toContain('[E2E_TEST] 履歴の支出')
    const accounts = await (await page.request.get('/api/accounts', { headers })).json()
    expect(accounts.map((account: { name: string }) => account.name)).toEqual(['[E2E_TEST] 残す口座'])
    const reuse = await page.request.post('/api/expenses', {
      headers,
      data: { expenseDate, amount: 1, purpose: '[E2E_TEST] 再利用', categoryId: categories[0].id, accountId: target.id },
    })
    expect(reuse.status()).toBe(400)

    // 家計簿の入力フォームの口座選択肢にも出ない
    await page.goto('/kakeibo')
    await page.getByTestId('transaction-panel').getByRole('button', { name: '登録', exact: true }).click()
    const options = await page.locator('#tx-account option').allTextContents()
    expect(options.join(',')).toContain('残す口座')
    expect(options.join(',')).not.toContain('削除する口座')
  })
}

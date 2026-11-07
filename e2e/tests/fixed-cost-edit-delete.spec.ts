import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

test('390px: 固定費の編集削除失敗でも下書きを保持し、明示再試行だけを送る (#423)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  await setupUserWithHousehold(page, 'fixed_edit_delete_failure')
  const headers = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('homelog.accessToken')) }
  const accountResponse = await page.request.post('/api/accounts', { headers, data: { name: '[E2E_TEST] 編集元口座', type: 'bank', balance: 10000 } })
  expect(accountResponse.status()).toBe(201)
  const account = await accountResponse.json()
  const name = '[E2E_TEST] 削除対象の保存済固定費'
  const createdResponse = await page.request.post('/api/fixed-costs', { headers, data: { name, amount: 80000, paymentDay: 27, personal: false, includeInHouseholdTotal: true, accountId: account.id } })
  expect(createdResponse.status()).toBe(201)
  const created = await createdResponse.json()
  const apiPath = '/api/fixed-costs/' + created.id
  let deletes = 0, patches = 0, posts = 0
  let release = () => {}
  const pending = new Promise<void>(resolve => { release = resolve })
  consoleGuard.allow({ url: new RegExp(apiPath + '$'), message: /^Failed to load resource:.*500/ })
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (request.method() === 'PATCH' && path === apiPath) patches++
    if (request.method() === 'POST' && path === '/api/fixed-costs') posts++
  })
  await page.route('**' + apiPath, async route => {
    const method = route.request().method()
    if (method !== 'DELETE') return route.continue()
    if (++deletes !== 1) return route.continue()
    await pending
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'INTERNAL_ERROR', message: '[E2E_TEST] 一時削除失敗', details: [] }) })
  })
  try {
    await page.goto('/fixed-costs')
    const row = page.getByRole('button', { name: name + 'の詳細', exact: true })
    await row.click()
    await page.getByRole('dialog', { name: '固定費詳細', exact: true }).getByRole('button', { name: '編集', exact: true }).click()
    const edit = page.getByRole('dialog', { name: '固定費を編集', exact: true })
    const editor = await edit.elementHandle()
    const draftName = '[E2E_TEST] 保存しない下書き'
    await edit.getByLabel('固定費名', { exact: true }).fill(draftName)
    await edit.getByLabel('金額', { exact: true }).fill('76543')
    await edit.getByLabel('支払日', { exact: true }).fill('29')
    await edit.getByLabel('引き落とし元（任意）', { exact: true }).selectOption('')
    await edit.getByRole('radio', { name: '個人', exact: true }).check()
    await edit.getByLabel('世帯合計に含める').uncheck()
    const trash = edit.getByRole('button', { name: name + 'を削除', exact: true })
    await trash.click()
    const confirmation = page.getByRole('dialog', { name: '固定費を削除しますか？', exact: true })
    const submit = confirmation.getByRole('button', { name: '削除する', exact: true })
    const cancel = confirmation.getByRole('button', { name: 'キャンセル', exact: true })
    await expect(confirmation).toContainText(name)
    await expect(confirmation).not.toContainText(draftName)
    await expect(cancel).toBeFocused()
    await expect(edit).toBeHidden()
    expect(await editor!.evaluate(el => el.isConnected)).toBe(true)
    await submit.click()
    await expect.poll(() => deletes).toBe(1)
    await expect(submit).toBeDisabled()
    await expect(cancel).toBeDisabled()
    await page.keyboard.press('Escape')
    await confirmation.locator('..').click({ position: { x: 2, y: 2 } })
    await page.keyboard.press('Enter')
    await expect(confirmation).toBeVisible()
    expect(deletes).toBe(1)
    release()
    await expect(confirmation).toBeHidden()
    await expect(edit).toBeVisible()
    await expect(page.getByText('[E2E_TEST] 一時削除失敗', { exact: true })).toBeVisible()
    await expect(trash).toBeFocused()
    expect(await editor!.evaluate(el => el.isConnected)).toBe(true)
    await expect(edit.getByLabel('固定費名', { exact: true })).toHaveValue(draftName)
    await expect(edit.getByLabel('金額', { exact: true })).toHaveValue('76543')
    await expect(edit.getByLabel('支払日', { exact: true })).toHaveValue('29')
    await expect(edit.getByLabel('引き落とし元（任意）', { exact: true })).toHaveValue('')
    await expect(edit.getByRole('radio', { name: '個人', exact: true })).toBeChecked()
    await expect(edit.getByLabel('世帯合計に含める')).not.toBeChecked()
    const snapshot = await page.request.get('/api/fixed-costs', { headers })
    expect(snapshot.status()).toBe(200)
    expect(await snapshot.json()).toEqual([created])
    expect(patches).toBe(0)
    expect(posts).toBe(0)
    await trash.click()
    await confirmation.getByRole('button', { name: '削除する', exact: true }).click()
    await expect(confirmation).toBeHidden()
    await expect(edit).toBeHidden()
    await expect(row).toHaveCount(0)
    await expect(page.getByRole('button', { name: '固定費を登録', exact: true })).toBeFocused()
    expect(deletes).toBe(2)
    expect(patches).toBe(0)
    expect(posts).toBe(0)
  } finally { release() }
})

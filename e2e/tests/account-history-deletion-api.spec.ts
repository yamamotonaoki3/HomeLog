import { expect, test } from './console-guard'
import { setupUserWithHousehold, register, joinHousehold } from './support/flows'
import { newUser } from './support/test-data'

test('精算済みの支払元・受取先口座を削除しても実APIの精算履歴を保持する (#368)', async ({ page, browser, baseURL, consoleGuard }) => {
  consoleGuard.watch(page)
  await setupUserWithHousehold(page, 'history_delete_payer')
  const headers = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('homelog.accessToken'))}` }
  const home = await (await page.request.get('/api/households/me', { headers })).json()
  const context = await browser.newContext({ baseURL })
  try {
    const debtorPage = await context.newPage()
    consoleGuard.watch(debtorPage)
    await register(debtorPage, newUser('history_delete_debtor'))
    await joinHousehold(debtorPage, home.inviteCode)
    const debtorHeaders = { Authorization: `Bearer ${await debtorPage.evaluate(() => localStorage.getItem('homelog.accessToken'))}` }
    const me = await (await debtorPage.request.get('/api/auth/me', { headers: debtorHeaders })).json()
    const receivingRes = await page.request.post('/api/accounts', { headers, data: { name: '[E2E_TEST] receiving', type: 'bank', balance: 3000 } })
    const payingRes = await debtorPage.request.post('/api/accounts', { headers: debtorHeaders, data: { name: '[E2E_TEST] paying', type: 'bank', balance: 10000 } })
    expect(receivingRes.status()).toBe(201)
    expect(payingRes.status()).toBe(201)
    const receiving = await receivingRes.json()
    const paying = await payingRes.json()
    const categories = await (await page.request.get('/api/kakeibo-categories', { headers })).json()
    const created = await page.request.post('/api/expenses', { headers, data: { expenseDate: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), amount: 1000, purpose: '[E2E_TEST] shared purchase', categoryId: categories[0].id, splitInputType: 'ratio', splits: [{ debtorUserId: me.id, ratio: 50 }] } })
    expect(created.status()).toBe(201)
    const [split] = await (await page.request.get('/api/expense-splits', { headers })).json()
    expect((await page.request.patch(`/api/expense-splits/${split.id}/request`, { headers })).status()).toBe(200)
    expect((await debtorPage.request.patch(`/api/expense-splits/${split.id}/mark-paid`, { headers: debtorHeaders, data: { accountId: paying.id } })).status()).toBe(200)
    expect((await page.request.patch(`/api/expense-splits/${split.id}/confirm-receipt`, { headers, data: { accountId: receiving.id } })).status()).toBe(200)
    const beforeExpenses = await (await debtorPage.request.get('/api/expenses', { headers: debtorHeaders })).json()
    const beforeIncomes = await (await page.request.get('/api/incomes', { headers })).json()
    expect((await page.request.delete(`/api/accounts/${paying.id}`, { headers })).status()).toBe(404)
    expect((await debtorPage.request.delete(`/api/accounts/${paying.id}`, { headers: debtorHeaders })).status()).toBe(204)
    expect((await page.request.delete(`/api/accounts/${receiving.id}`, { headers })).status()).toBe(204)
    expect(await (await debtorPage.request.get('/api/accounts', { headers: debtorHeaders })).json()).toEqual([])
    expect(await (await page.request.get('/api/accounts', { headers })).json()).toEqual([])
    expect(await (await debtorPage.request.get('/api/expenses', { headers: debtorHeaders })).json()).toEqual(beforeExpenses)
    expect(await (await page.request.get('/api/incomes', { headers })).json()).toEqual(beforeIncomes)
    expect(beforeIncomes).toEqual([expect.objectContaining({ accountName: '[E2E_TEST] receiving' })])
    expect(await (await page.request.get('/api/expense-splits', { headers })).json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: split.id, status: 'settled' })]))
    expect((await debtorPage.request.delete(`/api/accounts/${paying.id}`, { headers: debtorHeaders })).status()).toBe(404)
    expect((await debtorPage.request.post('/api/expenses', { headers: debtorHeaders, data: { expenseDate: '2026-10-25', amount: 1, categoryId: categories[0].id, accountId: paying.id } })).status()).toBe(400)
  } finally {
    await context.close()
  }
})

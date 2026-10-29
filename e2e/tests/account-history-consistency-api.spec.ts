import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

test('入金と履歴取得が重なっても応答内の残高と明細が整合し、本人以外には返さない (#393)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  await setupUserWithHousehold(page, 'history_consistency')
  const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
  const headers = { Authorization: `Bearer ${token}` }
  const accountResponse = await page.request.post('/api/accounts', { headers, data: { name: '[E2E_TEST] history', type: 'bank', balance: 10000 } })
  expect(accountResponse.status()).toBe(201)
  const { id: accountId } = await accountResponse.json()
  const categoriesResponse = await page.request.get('/api/income-categories', { headers })
  expect(categoriesResponse.status()).toBe(200)
  const [{ id: categoryId }] = await categoriesResponse.json()
  const history = () => page.request.get(`/api/accounts/${accountId}/transactions`, { headers })
  const assertConsistent = (body: { currentBalance: number; transactions: { type: string; amount: number; balanceAfter: number }[] }) => {
    expect(body.currentBalance).toBe(10000 + body.transactions.length * 100)
    for (const [index, row] of body.transactions.entries()) {
      expect(row).toMatchObject({ type: 'income', amount: 100, balanceAfter: 10000 + (body.transactions.length - index) * 100 })
    }
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    const [income, response] = await Promise.all([
      page.request.post('/api/incomes', { headers, data: { incomeDate: '2030-01-01', amount: 100, content: '[E2E_TEST] concurrent deposit', categoryId, accountId } }),
      history(),
    ])
    expect(income.status()).toBe(201)
    expect(response.status()).toBe(200)
    assertConsistent(await response.json())
  }
  const finalResponse = await history()
  expect(finalResponse.status()).toBe(200)
  const final = await finalResponse.json()
  assertConsistent(final)
  expect(final.currentBalance).toBe(11000)

  const email = `e2euser_history_other_${crypto.randomUUID()}@example.com`
  const password = 'TestPass123!'
  expect((await page.request.post('/api/auth/register', { data: { email, password, displayName: 'e2euser_history_other' } })).status()).toBe(201)
  const login = await page.request.post('/api/auth/login', { data: { email, password } })
  expect(login.status()).toBe(200)
  const { accessToken } = await login.json()
  const otherHeaders = { Authorization: `Bearer ${accessToken}` }
  const household = await page.request.get('/api/households/me', { headers })
  expect(household.status()).toBe(200)
  const { inviteCode } = await household.json()
  expect((await page.request.post('/api/households/join', { headers: otherHeaders, data: { inviteCode } })).status()).toBe(200)
  expect((await page.request.get(`/api/accounts/${accountId}/transactions`, { headers: otherHeaders })).status()).toBe(404)
  expect((await page.request.delete(`/api/accounts/${accountId}`, { headers })).status()).toBe(204)
  expect((await history()).status()).toBe(404)
})

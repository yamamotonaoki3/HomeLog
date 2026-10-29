import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

// 世帯外の精算済み内訳の削除API(#301)の契約を、実行中のWorkers経由で確認する。
for (const deleteAccount of [false, true]) {
test(`世帯外の精算取消で${deleteAccount ? '削除済み口座を復活させず履歴を消せる (#392)' : '有効口座の残高が戻る'}`, async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  await setupUserWithHousehold(page, 'warikan_settled_delete_api')
  const token = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
  const headers = { Authorization: `Bearer ${token}` }
  const account = await (await page.request.post('/api/accounts', { headers, data: { name: '[E2E_TEST] 精算口座', type: 'bank', balance: 3000 } })).json()
  const categories = await (await page.request.get('/api/kakeibo-categories', { headers })).json()
  const expense = await page.request.post('/api/expenses', {
    headers,
    data: { expenseDate: '2030-01-10', amount: 1000, purpose: '[E2E_TEST] 精算済みを消す', categoryId: categories[0].id, splitInputType: 'amount', splits: [{ debtorExternalName: 'e2euser_external_settled', amountDue: 400 }] },
  })
  expect(expense.status()).toBe(201)
  const { id: expenseId } = await expense.json()
  const split = (await (await page.request.get('/api/expense-splits', { headers })).json()).find((item: { expenseId: number }) => item.expenseId === expenseId)
  expect((await page.request.patch(`/api/expense-splits/${split.id}/settle-self`, { headers, data: { accountId: account.id } })).status()).toBe(200)
  const balance = async () => (await (await page.request.get('/api/accounts', { headers })).json()).find((item: { id: number }) => item.id === account.id).balance
  expect(await balance()).toBe(3400)

  if (deleteAccount) {
    expect((await page.request.delete(`/api/accounts/${account.id}`, { headers })).status()).toBe(204)
  }

  const deleted = await page.request.delete(`/api/expense-splits/${split.id}`, { headers })
  expect(deleted.status()).toBe(200)
  expect(await deleted.json()).toEqual({ settlementLedgerRemoved: true })
  if (deleteAccount) {
    const accounts = await (await page.request.get('/api/accounts', { headers })).json()
    expect(accounts.find((item: { id: number }) => item.id === account.id)).toBeUndefined()
    expect((await page.request.get(`/api/accounts/${account.id}/transactions`, { headers })).status()).toBe(404)
  } else {
    expect(await balance()).toBe(3000)
  }
  expect(await (await page.request.get('/api/incomes', { headers })).json()).toHaveLength(0)
  expect(await (await page.request.get('/api/expenses', { headers })).json()).toHaveLength(1)
  expect((await page.request.delete(`/api/expense-splits/${split.id}`, { headers })).status()).toBe(404)
  const splits = await (await page.request.get('/api/expense-splits', { headers })).json()
  expect(splits.find((item: { id: number }) => item.id === split.id)).toBeUndefined()
})
}

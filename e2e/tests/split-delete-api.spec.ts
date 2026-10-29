import type { APIRequestContext } from '@playwright/test'
import { expect, test } from './console-guard'

const password = 'TestPass123!'

async function createActor(request: APIRequestContext, label: string) {
  const email = `e2euser_split_delete_${label}_${crypto.randomUUID()}@example.com`
  const registration = await request.post('/api/auth/register', { data: { email, password, displayName: `e2euser_${label}` } })
  expect(registration.status()).toBe(201)
  const { id } = await registration.json()
  const login = await request.post('/api/auth/login', { data: { email, password } })
  expect(login.status()).toBe(200)
  const { accessToken } = await login.json()
  return { id: id as number, headers: { Authorization: `Bearer ${accessToken}` } }
}

test('割り勘の精算と削除が競合しても精算明細と残高の整合性を保つ (#391)', async ({ page, consoleGuard }) => {
  consoleGuard.watch(page)
  const request = page.request
  const owner = await createActor(request, 'owner')
  const member = await createActor(request, 'member')
  const household = await request.post('/api/households', { headers: owner.headers, data: { name: '[E2E_TEST] split delete race' } })
  expect(household.status()).toBe(201)
  const { inviteCode } = await household.json()
  expect((await request.post('/api/households/join', { headers: member.headers, data: { inviteCode } })).status()).toBe(200)

  const categories = await request.get('/api/kakeibo-categories', { headers: owner.headers })
  expect(categories.status()).toBe(200)
  const [{ id: categoryId }] = await categories.json()
  const accountIds: number[] = []
  for (const actor of [owner, member]) {
    const response = await request.post('/api/accounts', { headers: actor.headers, data: { name: '[E2E_TEST] account', type: 'bank', balance: 10000 } })
    expect(response.status()).toBe(201)
    accountIds.push((await response.json()).id)
  }

  const createSplit = async () => {
    const response = await request.post('/api/expenses', {
      headers: owner.headers,
      data: { expenseDate: '2026-10-29', amount: 1000, purpose: '[E2E_TEST] race', categoryId,
        splitInputType: 'amount', splits: [{ debtorUserId: member.id, amountDue: 500 }] },
    })
    expect(response.status()).toBe(201)
    const { id: expenseId } = await response.json()
    const splits = await request.get('/api/expense-splits', { headers: owner.headers })
    expect(splits.status()).toBe(200)
    const split = (await splits.json()).find((row: { expenseId: number }) => row.expenseId === expenseId)
    expect(split).toBeTruthy()
    return split.id as number
  }
  const markPaid = (id: number) => request.patch(`/api/expense-splits/${id}/mark-paid`, { headers: member.headers, data: { accountId: accountIds[1] } })
  const confirm = (id: number) => request.patch(`/api/expense-splits/${id}/confirm-receipt`, { headers: owner.headers, data: { accountId: accountIds[0] } })
  const remove = (id: number) => request.delete(`/api/expense-splits/${id}`, { headers: owner.headers })

  // 削除が先なら、後から精算しても明細・残高を動かさない。
  const deletedId = await createSplit()
  expect((await markPaid(deletedId)).status()).toBe(200)
  expect((await remove(deletedId)).status()).toBe(204)
  expect((await confirm(deletedId)).status()).toBe(404)

  // 同時操作はどちらの確定順も許すが、中間状態を残すことは許さない。
  const racedId = await createSplit()
  expect((await markPaid(racedId)).status()).toBe(200)
  const [confirmed, removed] = await Promise.all([confirm(racedId), remove(racedId)])
  const settled = confirmed.status() === 200
  if (settled) {
    expect([400, 409]).toContain(removed.status())
    expect((await remove(racedId)).status()).toBe(400)
  } else {
    expect([400, 404]).toContain(confirmed.status())
    expect(removed.status()).toBe(204)
  }

  for (const [index, actor] of [owner, member].entries()) {
    const accounts = await request.get('/api/accounts', { headers: actor.headers })
    expect(accounts.status()).toBe(200)
    expect((await accounts.json()).find((row: { id: number }) => row.id === accountIds[index]).balance)
      .toBe(10000 + (settled ? (index === 0 ? 500 : -500) : 0))
    const kind = index === 0 ? 'incomes' : 'expenses'
    const response = await request.get(`/api/${kind}`, { headers: actor.headers })
    expect(response.status()).toBe(200)
    const rows = await response.json()
    expect(rows).toHaveLength(settled ? 1 : 0)
    if (settled) {
      expect((await request.delete(`/api/${kind}/${rows[0].id}`, { headers: actor.headers })).status()).toBe(409)
      expect((await request.put(`/api/${kind}/${rows[0].id}`, { headers: actor.headers, data: {} })).status()).toBe(409)
    }
  }
})

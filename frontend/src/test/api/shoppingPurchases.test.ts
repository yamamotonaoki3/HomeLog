import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { setTokens, clearTokens } from '../../api/tokenStorage'
import { captureCredentials, verifyPurchaseScope, purchaseResult, type PurchaseCredentials } from '../../api/shoppingPurchases'
const scope = { actorUserId: 1, householdId: 10 }
const body = { requestId: '12345678-1234-4234-8234-123456789abc', items: [{ id: 11, purchasedQuantity: 2, expectedPurchaseRevision: 3 }] }
const success = { requestId: body.requestId, updatedInventoryItems: [{ id: 21, quantity: 4 }], removedShoppingListItemIds: [], remainingShoppingListItems: [{ id: 11, plannedQuantity: 1, purchaseRevision: 4 }] }
beforeEach(() => setTokens('testuser_a_access','testuser_a_refresh'))
afterEach(() => { clearTokens(); vi.restoreAllMocks() })
it('同じ固定認証で本人/世帯の両GETを確認する', async () => {
  const seen: string[] = []
  server.use(http.get('/api/auth/me', ({ request }) => { seen.push(request.headers.get('authorization') === 'Bearer testuser_a_access' ? 'A' : 'other'); return HttpResponse.json({ id: 1 }) }), http.get('/api/households/me', () => HttpResponse.json({ id: 10 })))
  const credentials = captureCredentials()!
  expect(await verifyPurchaseScope(credentials, scope, () => true)).toEqual(scope)
  expect(seen).toEqual(['A'])
})
it.each(['auth','household'])('await中のcredential変更でscopeを確定しない: %s', async (point) => {
  let householdGets = 0
  server.use(http.get('/api/auth/me', () => { if (point === 'auth') setTokens('testuser_b_access','testuser_b_refresh'); return HttpResponse.json({ id: 1 }) }), http.get('/api/households/me', () => { householdGets++; setTokens('testuser_b_access','testuser_b_refresh'); return HttpResponse.json({ id: 10 }) }))
  const credentials: PurchaseCredentials = captureCredentials()!
  await expect(verifyPurchaseScope(credentials, scope, () => true)).rejects.toThrow()
  expect(householdGets).toBe(point === 'auth' ? 0 : 1)
})
it('別世帯と不正actorを拒否する', async () => {
  server.use(http.get('/api/auth/me', () => HttpResponse.json({ id: 1 })), http.get('/api/households/me', () => HttpResponse.json({ id: 20 })))
  await expect(verifyPurchaseScope(captureCredentials()!, scope, () => true)).rejects.toThrow()
})
it('正常200だけ成功、ID/集合/revision/数量が不整合ならunknown', () => {
  expect(purchaseResult(200, success, body).kind).toBe('success')
  for (const data of [{ ...success, requestId: 'bad' }, { ...success, removedShoppingListItemIds: [11] }, { ...success, remainingShoppingListItems: [{ id: 11, plannedQuantity: 1, purchaseRevision: 3 }] }, { ...success, updatedInventoryItems: [{ id: 21, quantity: -1 }] }]) expect(purchaseResult(200, data, body).kind).toBe('unknown')
})
it.each([[400,'VALIDATION_ERROR'],[404,'RESOURCE_NOT_FOUND'],[409,'RESOURCE_CONFLICT']] as const)('保存terminalのみnotApplied: %s', (status, code) => {
  expect(purchaseResult(status, { code, details: [{ field: 'purchase', reason: 'PURCHASE_NOT_APPLIED' }] }, body).kind).toBe('notApplied')
  expect(purchaseResult(status, { code }, body).kind).toBe('unknown')
})
it.each([401,500,503,409])('未知status/codeはpending保持: %s', (status) => {
  expect(purchaseResult(status, { code: 'SHOPPING_PURCHASE_REQUEST_MISMATCH', details: [{ field: 'requestId', reason: 'PAYLOAD_MISMATCH' }] }, body).kind).toBe('unknown')
})

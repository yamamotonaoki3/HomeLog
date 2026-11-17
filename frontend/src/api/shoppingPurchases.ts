import { apiClient } from './client'
import { getAccessToken, getRefreshToken } from './tokenStorage'
import { positiveId, quantityValid, revisionValid, type PurchaseRequest, type PurchaseScope } from '../lib/shoppingPending'
export class PurchaseIdentityError extends Error { }
export interface PurchaseCredentials { accessToken: string; refreshToken: string }
export interface PurchaseResult {
  requestId: string
  updatedInventoryItems: { id: number; quantity: number }[]
  removedShoppingListItemIds: number[]
  remainingShoppingListItems: { id: number; plannedQuantity: number; purchaseRevision: number }[]
}
export type PurchaseOutcome = { kind: 'success'; result: PurchaseResult } | { kind: 'notApplied' | 'unknown' }
export function captureCredentials(): PurchaseCredentials | null {
  try {
    const accessToken = getAccessToken(), refreshToken = getRefreshToken()
    return accessToken && refreshToken ? { accessToken, refreshToken } : null
  } catch { return null }
}
export function credentialsMatch(credentials: PurchaseCredentials): boolean {
  const current = captureCredentials()
  return current?.accessToken === credentials.accessToken && current.refreshToken === credentials.refreshToken
}
export function boundConfig(credentials: PurchaseCredentials, signal?: AbortSignal) {
  return { authMode: 'bound-no-refresh' as const, headers: { Authorization: 'Bearer ' + credentials.accessToken }, signal }
}
export async function verifyPurchaseScope(credentials: PurchaseCredentials, expected: PurchaseScope | null, valid: () => boolean, signal?: AbortSignal): Promise<PurchaseScope> {
  const check = () => { if (!valid() || signal?.aborted || !credentialsMatch(credentials)) throw new PurchaseIdentityError('購入の本人確認をやり直してください') }
  check()
  const actor = await apiClient.get<{ id: number }>('/auth/me', boundConfig(credentials, signal))
  check()
  if (!positiveId(actor.data?.id) || (expected && actor.data.id !== expected.actorUserId)) throw new PurchaseIdentityError('購入の本人確認をやり直してください')
  check()
  const household = await apiClient.get<{ id: number }>('/households/me', boundConfig(credentials, signal))
  check()
  if (!positiveId(household.data?.id) || (expected && household.data.id !== expected.householdId)) throw new PurchaseIdentityError('購入の世帯確認をやり直してください')
  return { actorUserId: actor.data.id, householdId: household.data.id }
}
export function purchaseResult(status: number, data: unknown, body: PurchaseRequest): PurchaseOutcome {
  if (!data || typeof data !== 'object') return { kind: 'unknown' }
  const v = data as PurchaseResult
  if (status === 200) {
    if (v.requestId !== body.requestId || !Array.isArray(v.updatedInventoryItems) || !Array.isArray(v.removedShoppingListItemIds) || !Array.isArray(v.remainingShoppingListItems)) return { kind: 'unknown' }
    const positive = body.items.filter(line => line.purchasedQuantity > 0)
    const ids = new Set(positive.map(line => line.id))
    if (v.updatedInventoryItems.length !== positive.length || v.updatedInventoryItems.some(line => !line || !positiveId(line.id) || !quantityValid(line.quantity)) || new Set(v.updatedInventoryItems.map(line => line.id)).size !== positive.length) return { kind: 'unknown' }
    if (v.removedShoppingListItemIds.some(id => !positiveId(id)) || v.remainingShoppingListItems.some(line => {
      if (!line || !positiveId(line.id) || !quantityValid(line.plannedQuantity, 0.1) || !revisionValid(line.purchaseRevision)) return true
      const requested = positive.find(item => item.id === line.id)
      return !requested || line.purchaseRevision !== requested.expectedPurchaseRevision + 1
    })) return { kind: 'unknown' }
    const completed = [...v.removedShoppingListItemIds, ...v.remainingShoppingListItems.map(line => line.id)]
    if (completed.length !== positive.length || new Set(completed).size !== positive.length || completed.some(id => !ids.has(id))) return { kind: 'unknown' }
    return { kind: 'success', result: v }
  }
  const error = data as { code?: string; details?: { field?: string; reason?: string }[] }
  const expectedCode = status === 400 ? 'VALIDATION_ERROR' : status === 404 ? 'RESOURCE_NOT_FOUND' : status === 409 ? 'RESOURCE_CONFLICT' : null
  if (expectedCode && error.code === expectedCode && Array.isArray(error.details) && error.details.some(d => d?.field === 'purchase' && d.reason === 'PURCHASE_NOT_APPLIED')) return { kind: 'notApplied' }
  return { kind: 'unknown' }
}

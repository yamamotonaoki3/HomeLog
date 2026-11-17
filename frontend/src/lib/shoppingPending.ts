export interface PurchaseScope { actorUserId: number; householdId: number }
export interface PurchaseLine { id: number; purchasedQuantity: number; expectedPurchaseRevision: number }
export interface PurchaseRequest { requestId: string; items: PurchaseLine[] }
export interface PurchasePending extends PurchaseScope, PurchaseRequest { version: 1; createdAt: string }
export type PendingRead = { kind: 'empty' | 'corrupt' | 'blocked' } | { kind: 'pending'; pending: PurchasePending }
export type PendingSave = { kind: 'blocked' } | { kind: 'saved' | 'existing'; pending: PurchasePending }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
export const revisionValid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
export function quantityValid(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= 99999.9 && Math.abs(value * 10 - Math.round(value * 10)) < 1e-7
}
export function parseQuantity(text: string, minimum = 0): number | null {
  if (!/^\d+(?:\.\d)?$/.test(text.trim())) return null
  const value = Number(text)
  return quantityValid(value, minimum) ? value : null
}
export const pendingKey = (scope: PurchaseScope) => 'homelog.shoppingPending.v1:' + scope.actorUserId + ':' + scope.householdId
export function requestValid(value: unknown): value is PurchaseRequest {
  if (!value || typeof value !== 'object') return false
  const v = value as PurchaseRequest
  return typeof v.requestId === 'string' && uuid.test(v.requestId) && v.requestId === v.requestId.toLowerCase() && Array.isArray(v.items) && v.items.length > 0 &&
    new Set(v.items.map(line => line?.id)).size === v.items.length && v.items.every(line => line && positiveId(line.id) && quantityValid(line.purchasedQuantity) && revisionValid(line.expectedPurchaseRevision))
}
export const sameRequest = (a: PurchaseRequest, b: PurchaseRequest) => a.requestId === b.requestId && JSON.stringify(a.items) === JSON.stringify(b.items)
export function readPending(scope: PurchaseScope): PendingRead {
  try {
    if (!positiveId(scope.actorUserId) || !positiveId(scope.householdId)) return { kind: 'blocked' }
    const raw = localStorage.getItem(pendingKey(scope))
    if (raw === null) return { kind: 'empty' }
    let value: PurchasePending
    try { value = JSON.parse(raw) as PurchasePending } catch { return { kind: 'corrupt' } }
    if (!requestValid(value) || value.version !== 1 || value.actorUserId !== scope.actorUserId || value.householdId !== scope.householdId || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) return { kind: 'corrupt' }
    // Only the exact minimal schema is accepted; never retain names, headers or credentials.
    if (Object.keys(value).sort().join() !== 'actorUserId,createdAt,householdId,items,requestId,version' || value.items.some(line => Object.keys(line).sort().join() !== 'expectedPurchaseRevision,id,purchasedQuantity')) return { kind: 'corrupt' }
    return { kind: 'pending', pending: value }
  } catch { return { kind: 'blocked' } }
}
export function pendingAvailable() {
  return window.isSecureContext === true && typeof navigator.locks?.request === 'function'
}
async function withPendingLock<T>(scope: PurchaseScope, valid: () => boolean, operation: () => T, signal?: AbortSignal): Promise<T> {
  if (!pendingAvailable() || !valid() || signal?.aborted) throw new Error('購入の安全な保存を利用できません')
  return navigator.locks.request(pendingKey(scope), { mode: 'exclusive', ...(signal ? { signal } : {}) }, () => {
    if (!valid() || signal?.aborted) throw new Error('セッションが変更されました')
    return operation()
  })
}
export async function savePending(scope: PurchaseScope, requestOrCreate: PurchaseRequest | (() => PurchaseRequest), valid: () => boolean, signal?: AbortSignal): Promise<PendingSave> {
  try {
    return await withPendingLock(scope, valid, (): PendingSave => {
      const old = readPending(scope)
      if (old.kind === 'pending') return { kind: 'existing', pending: old.pending }
      if (old.kind !== 'empty') return { kind: 'blocked' }
      const request = typeof requestOrCreate === 'function' ? requestOrCreate() : requestOrCreate
      if (!requestValid(request)) return { kind: 'blocked' }
      const pending: PurchasePending = {
        version: 1, actorUserId: scope.actorUserId, householdId: scope.householdId, requestId: request.requestId,
        items: request.items.map(({ id, purchasedQuantity, expectedPurchaseRevision }) => ({ id, purchasedQuantity, expectedPurchaseRevision })), createdAt: new Date().toISOString()
      }
      if (!valid()) return { kind: 'blocked' }
      localStorage.setItem(pendingKey(scope), JSON.stringify(pending))
      const readback = readPending(scope)
      if (!valid() || readback.kind !== 'pending' || JSON.stringify(readback.pending) !== JSON.stringify(pending)) return { kind: 'blocked' }
      return { kind: 'saved', pending: readback.pending }
    }, signal)
  } catch { return { kind: 'blocked' } }
}
export async function removePending(pending: PurchasePending, valid: () => boolean, signal?: AbortSignal): Promise<boolean> {
  try {
    return await withPendingLock(pending, valid, () => {
      const current = readPending(pending)
      if (current.kind !== 'pending' || !sameRequest(current.pending, pending) || !valid()) return false
      localStorage.removeItem(pendingKey(pending))
      return valid() && readPending(pending).kind === 'empty'
    }, signal)
  } catch { return false }
}

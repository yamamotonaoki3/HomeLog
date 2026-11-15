import type { LinkedInventoryCreateBody } from '../api/zaikoTypes'
import { positiveId, quantityValid, revisionValid } from './shoppingPending'
export interface MenuScope { actorUserId: number; householdId: number }
export type MenuRequest = { kind: 'register'; body: LinkedInventoryCreateBody } | { kind: 'consume' | 'undo'; entryId: number; body: { requestId: string; expectedRevision: number } }
export type MenuOperationEnvelope = MenuRequest & MenuScope & { version: 1; createdAt: string }
export type MenuPendingRead = { kind: 'empty' | 'corrupt' | 'blocked' } | { kind: 'pending'; pending: MenuOperationEnvelope }
export type MenuPendingSave = { kind: 'blocked' } | { kind: 'saved' | 'existing'; pending: MenuOperationEnvelope }
export const menuPendingKey = (scope: MenuScope) => 'homelog.menuOperation.v1:' + scope.actorUserId + ':' + scope.householdId
const keys = (value: object, required: string[], optional: string[] = []) => required.every(k => Object.hasOwn(value,k)) && Object.keys(value).every(k => required.includes(k) || optional.includes(k))
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
export function menuRequestValid(input: unknown): input is MenuRequest {
 if (!input || typeof input !== 'object') return false
 const v = input as MenuRequest
 if (!v.body || typeof v.body !== 'object') return false
 if(v.kind === 'consume' || v.kind === 'undo') return positiveId(v.entryId) && keys(v.body,['requestId','expectedRevision']) && uuid(v.body.requestId) && revisionValid(v.body.expectedRevision)
 if(v.kind !== 'register') return false
 const b = v.body
 if(!keys(b,['name','categoryId','storeId','quantity','threshold','menuLinkage'],['price','dailyConsumption','autoConsumptionEnabled']) || typeof b.name !== 'string' || !b.name.trim() || b.name.length > 50 || !positiveId(b.categoryId) || !(b.storeId === null || positiveId(b.storeId)) || !quantityValid(b.quantity) || !quantityValid(b.threshold)) return false
 if(b.price !== undefined && b.price !== null && (!Number.isInteger(b.price) || b.price < 0 || b.price > 9999999999)) return false
 if(b.dailyConsumption !== undefined && b.dailyConsumption !== null && !quantityValid(b.dailyConsumption,0.1)) return false
 if(b.autoConsumptionEnabled !== undefined && typeof b.autoConsumptionEnabled !== 'boolean') return false
 const m = b.menuLinkage
 return !!m && keys(m,['requestId','menus']) && uuid(m.requestId) && Array.isArray(m.menus) && m.menus.length > 0 && m.menus.length <= 20 && m.menus.every(line => line && keys(line,['usageQuantity','carryEnabled'],['recipeId','newRecipeTitle']) && quantityValid(line.usageQuantity,0.1) && typeof line.carryEnabled === 'boolean' && ((positiveId(line.recipeId) && line.newRecipeTitle === undefined) || (line.recipeId === undefined && typeof line.newRecipeTitle === 'string' && line.newRecipeTitle.trim().length > 0 && line.newRecipeTitle.length <= 100))) && new Set(m.menus.filter(l=>l.recipeId !== undefined).map(l=>l.recipeId)).size === m.menus.filter(l=>l.recipeId !== undefined).length
}
export function readMenuPending(scope: MenuScope): MenuPendingRead {
 try {
  if(!positiveId(scope.actorUserId) || !positiveId(scope.householdId)) return {kind:'blocked'}
  const raw = localStorage.getItem(menuPendingKey(scope))
  if(raw === null) return {kind:'empty'}
  const v = JSON.parse(raw) as MenuOperationEnvelope
  if(!menuRequestValid(v) || !keys(v,['version','createdAt','actorUserId','householdId','kind','body'],v.kind === 'register' ? [] : ['entryId']) || v.version !== 1 || v.actorUserId !== scope.actorUserId || v.householdId !== scope.householdId || typeof v.createdAt !== 'string' || !Number.isFinite(Date.parse(v.createdAt))) return {kind:'corrupt'}
  return {kind:'pending',pending:v}
 } catch { try { return localStorage.getItem(menuPendingKey(scope)) === null ? {kind:'empty'} : {kind:'corrupt'} } catch { return {kind:'blocked'} } }
}
export const menuPendingAvailable = () => window.isSecureContext === true && typeof navigator.locks?.request === 'function'
async function locked<T>(scope: MenuScope, valid: () => boolean, action: () => T): Promise<T> {
 if(!menuPendingAvailable() || !valid()) throw new Error('安全な保存を利用できません')
 return navigator.locks.request(menuPendingKey(scope),{mode:'exclusive'},()=>{if(!valid()) throw new Error('本人確認が必要です'); return action()})
}
export async function saveMenuPending(scope: MenuScope, create: () => MenuRequest, valid: () => boolean): Promise<MenuPendingSave> {
 try { return await locked(scope,valid,(): MenuPendingSave => {
  const old = readMenuPending(scope)
  if(old.kind === 'pending') return {kind:'existing',pending:old.pending}
  if(old.kind !== 'empty') return {kind:'blocked'}
  const request = create()
  if(!menuRequestValid(request) || !keys(request,['kind','body'],request.kind === 'register' ? [] : ['entryId'])) return {kind:'blocked'}
  const pending = JSON.parse(JSON.stringify({...request,...scope,version:1,createdAt:new Date().toISOString()})) as MenuOperationEnvelope
  if(!valid()) return {kind:'blocked'}
  localStorage.setItem(menuPendingKey(scope),JSON.stringify(pending))
  const check = readMenuPending(scope)
  return valid() && check.kind === 'pending' && JSON.stringify(check.pending) === JSON.stringify(pending) ? {kind:'saved',pending:check.pending} : {kind:'blocked'}
 }) } catch { return {kind:'blocked'} }
}
export async function removeMenuPending(pending: MenuOperationEnvelope, valid: () => boolean): Promise<boolean> {
 try { return await locked(pending,valid,()=>{
  const current = readMenuPending(pending)
  if(current.kind !== 'pending' || JSON.stringify(current.pending) !== JSON.stringify(pending) || !valid()) return false
  localStorage.removeItem(menuPendingKey(pending))
  return valid() && readMenuPending(pending).kind === 'empty'
 }) } catch { return false }
}

import { apiClient } from './client'
import { isAxiosError } from 'axios'
import { captureCredentials, credentialsMatch, boundConfig, verifyPurchaseScope, type PurchaseCredentials } from './shoppingPurchases'
import { positiveId, quantityValid, revisionValid } from '../lib/shoppingPending'
import type { MenuRequest, MenuScope } from '../lib/menuOperationPending'
import type { InventoryMenuLink, InventoryMenuLinkUpdate, LinkedInventoryCreateResult, InventoryPlanResult } from './zaikoTypes'
import type { MenuMealResult } from './kondateTypes'
export type { MenuScope } from '../lib/menuOperationPending'
export type MenuCredentials = PurchaseCredentials
export const captureMenuCredentials = captureCredentials
export const menuCredentialsMatch = credentialsMatch
export const verifyMenuScope = verifyPurchaseScope
export type MenuOperationOutcome = {kind:'success';operation:'register';result:LinkedInventoryCreateResult} | {kind:'success';operation:'plan-create'|'plan-replace';result:InventoryPlanResult} | {kind:'success';operation:'consume'|'undo';result:MenuMealResult} | {kind:'rejected'|'unknown'|'blocked'|'detached';message:string}
export function menuMutationOutcome(status: number, data: unknown, request: MenuRequest, recovering: boolean): MenuOperationOutcome {
 const unknown: MenuOperationOutcome = {kind:'unknown',message:'結果を確認できません。同じ内容で確認してください'}
 if(!data || typeof data !== 'object') return unknown
 if((request.kind === 'plan-create' && status === 201) || (request.kind === 'plan-replace' && status === 200)) {
  const v=data as InventoryPlanResult,b=request.body
  if(!positiveId(v.id) || (request.kind === 'plan-replace' && v.id !== request.itemId) || v.name !== b.name.trim() || v.categoryId !== b.categoryId || v.storeId !== b.storeId || !quantityValid(v.quantity) || (request.kind === 'plan-create' && v.quantity !== b.quantity) || v.threshold !== b.threshold || v.menuPlanEnabled !== b.menuPlan.enabled || !revisionValid(v.menuPlanRevision) || !Array.isArray(v.menuLinks) || v.menuLinks.length !== b.menuPlan.links.length || new Set(v.menuLinks.map(l=>l?.id)).size !== v.menuLinks.length || !Array.isArray(v.linkedMenuEntries)) return unknown
  if(v.menuLinks.some((l,i)=>{
   const line=b.menuPlan.links[i]
   return !l || !positiveId(l.id) || !(l.recipeId === null || positiveId(l.recipeId)) || typeof l.recipeTitle !== 'string' || !l.recipeTitle || !quantityValid(l.usageQuantity,0.1) || typeof l.enabled !== 'boolean' || !revisionValid(l.revision) || l.remainingCount !== line.remainingCount || l.memo !== line.memo || l.carryEnabled !== line.carryEnabled || (line.linkId !== undefined && l.id !== line.linkId) || (line.recipeId !== undefined && l.recipeId !== line.recipeId) || (line.newRecipeTitle !== undefined && l.recipeTitle !== line.newRecipeTitle.trim())
  }) || v.menuLinks.reduce((sum,l)=>sum+l.remainingCount,0) > v.quantity || v.linkedMenuEntries.some(e=>!e || !positiveId(e.id) || !(e.recipeId===null||positiveId(e.recipeId)) || typeof e.recipeTitle!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.weekStartDate) || !quantityValid(e.usageQuantity,0.1)) || new Set(v.linkedMenuEntries.map(e=>e.id)).size !== v.linkedMenuEntries.length) return unknown
  return {kind:'success',operation:request.kind,result:v}
 }
 if(request.kind === 'register' && status === 201) {
  const v = data as LinkedInventoryCreateResult, body=request.body
  if(!positiveId(v.id) || v.name !== body.name.trim() || v.categoryId !== body.categoryId || v.storeId !== body.storeId || v.quantity !== body.quantity || v.threshold !== body.threshold || !Array.isArray(v.linkedMenuEntries) || v.linkedMenuEntries.length !== body.menuLinkage.menus.length || new Set(v.linkedMenuEntries.map(e=>e?.id)).size !== v.linkedMenuEntries.length) return unknown
  if(v.linkedMenuEntries.some((e,i)=>!e || !positiveId(e.id) || !positiveId(e.recipeId) || typeof e.recipeTitle !== 'string' || !e.recipeTitle || !/^\d{4}-\d{2}-\d{2}$/.test(e.weekStartDate) || e.usageQuantity !== body.menuLinkage.menus[i].usageQuantity || (body.menuLinkage.menus[i].recipeId !== undefined && e.recipeId !== body.menuLinkage.menus[i].recipeId) || (body.menuLinkage.menus[i].newRecipeTitle !== undefined && e.recipeTitle !== body.menuLinkage.menus[i].newRecipeTitle!.trim()))) return unknown
  return {kind:'success',operation:'register',result:v}
 }
 if((request.kind === 'consume' || request.kind === 'undo') && status === 200) {
  const v=data as MenuMealResult
  if(v.menuEntryId !== request.entryId || v.mealRevision !== request.body.expectedRevision+1 || (request.kind === 'consume' ? v.mealState !== 'eaten' : v.mealState !== 'eaten' && v.mealState !== 'uneaten') || !positiveId(v.inventoryItemId) || !quantityValid(v.quantity) || typeof v.carryEnabled !== 'boolean' || (v.remainingCount !== undefined && v.remainingCount !== null && (!Number.isInteger(v.remainingCount) || v.remainingCount < 0 || v.remainingCount > 99999)) || (v.menuPlanEnabled !== undefined && typeof v.menuPlanEnabled !== 'boolean') || (v.menuPlanRevision !== undefined && !revisionValid(v.menuPlanRevision))) return unknown
  return {kind:'success',operation:request.kind,result:v}
 }
 const error=data as {code?:string;message?:string;details?:unknown}
 if(Array.isArray(error.details) && error.details.some((detail:unknown)=>detail !== null && typeof detail === 'object' && 'field' in detail && detail.field === 'requestId' && 'reason' in detail && detail.reason === 'PAYLOAD_MISMATCH')) return unknown
 const known = status === 400 ? ['VALIDATION_ERROR'] : status === 404 ? ['RESOURCE_NOT_FOUND'] : status === 409 ? ['RESOURCE_CONFLICT','DUPLICATE_INVENTORY_ITEM_NAME'] : []
 if(!recovering && known.includes(error.code??'')) return {kind:'rejected',message:typeof error.message === 'string'?error.message:'内容が変更されました。一覧を確認してください'}
 return unknown
}
export async function sendMenuOperation(request: MenuRequest, credentials: MenuCredentials, recovering: boolean, valid:()=>boolean): Promise<MenuOperationOutcome> {
 if(!valid() || !credentialsMatch(credentials)) return {kind:'detached',message:'本人と世帯を再確認してください'}
 const path = request.kind === 'register' || request.kind === 'plan-create' ? '/inventory-items' : request.kind === 'plan-replace' ? '/inventory-items/'+request.itemId : '/menu-entries/'+request.entryId+'/'+(request.kind === 'consume'?'consume':'undo-consumption')
 try {
  const response=await apiClient[request.kind === 'plan-replace' ? 'put' : 'post'](path,request.body,boundConfig(credentials))
  if(!valid() || !credentialsMatch(credentials)) return {kind:'detached',message:'ログイン状態が変更されました。元の結果は保存しています'}
  return menuMutationOutcome(response.status,response.data,request,recovering)
 } catch(error) {
  if(!valid() || !credentialsMatch(credentials)) return {kind:'detached',message:'ログイン状態が変更されました。元の結果は保存しています'}
  return isAxiosError(error) ? menuMutationOutcome(error.response?.status??0,error.response?.data,request,recovering) : {kind:'unknown',message:'結果を確認できません。同じ内容で確認してください'}
 }
}
export async function updateInventoryMenuLink(id:number, body:InventoryMenuLinkUpdate, scope:MenuScope, credentials:MenuCredentials, valid:()=>boolean, signal?:AbortSignal):Promise<InventoryMenuLink> {
 await verifyMenuScope(credentials,scope,valid,signal)
 if(!valid() || !credentialsMatch(credentials)) throw new Error('本人と世帯を再確認してください')
 const response=await apiClient.patch<InventoryMenuLink>('/inventory-menu-links/'+id,body,boundConfig(credentials,signal))
 if(!valid() || !credentialsMatch(credentials)) throw new Error('ログイン状態が変更されました')
 const v=response.data
 if(!v || v.id!==id || v.revision!==body.expectedRevision+1 || v.usageQuantity!==body.usageQuantity || v.enabled!==body.enabled || v.carryEnabled!==body.carryEnabled || typeof v.recipeTitle!=='string') throw new Error('連携設定の保存結果を確認できません。一覧を再取得してください')
 return v
}

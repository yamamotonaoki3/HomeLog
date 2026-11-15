import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { captureMenuCredentials, menuCredentialsMatch, sendMenuOperation, verifyMenuScope, type MenuOperationOutcome } from '../api/menuInventory'
import type { InventoryCreateBody, MenuLinkDraft } from '../api/zaikoTypes'
import { PurchaseIdentityError } from '../api/shoppingPurchases'
import { isAxiosError } from 'axios'
import { apiClient } from '../api/client'
import { menuPendingAvailable, readMenuPending, removeMenuPending, saveMenuPending, type MenuOperationEnvelope, type MenuScope } from '../lib/menuOperationPending'
export type MenuOperationInput = {kind:'register';inventory:InventoryCreateBody;menus:MenuLinkDraft[]} | {kind:'consume'|'undo';entryId:number;mealRevision:number}
interface Options { actorUserId?:number; onDetached?:()=>void }
export function useMenuInventoryOperation(options:Options = {}) {
 const callbacks=useRef(options), actor=useRef(options.actorUserId), generation=useRef(0), running=useRef(false), alive=useRef(true), scope=useRef<MenuScope|null>(null)
 const session=useRef<string|null>(null)
 const [verifiedScope,setVerifiedScope]=useState<MenuScope|null>(null),[pending,setPending]=useState<MenuOperationEnvelope|null>(null),[busy,setBusy]=useState(false),[outcome,setOutcome]=useState<MenuOperationOutcome|null>(null),[message,setMessage]=useState('')
 useLayoutEffect(()=>{
  callbacks.current=options
  if(actor.current!==options.actorUserId){actor.current=options.actorUserId;generation.current++;scope.current=null;session.current=null;running.current=false;setVerifiedScope(null);setPending(null);setOutcome(null);setMessage('本人と世帯を再確認してください');setBusy(false);options.onDetached?.()}
 },[options])
 const detached=useCallback(()=>{
  const invalidate=scope.current!==null||session.current!==null
  generation.current++;running.current=false;setBusy(false)
  scope.current=null;session.current=null;setVerifiedScope(null);setPending(null);if(invalidate)callbacks.current.onDetached?.()
  const result:MenuOperationOutcome={kind:'detached',message:'ログイン状態が変更されました。本人と世帯を再確認してください'}
  setOutcome(result);setMessage(result.message);return result
 },[])
 const recheck=useCallback(async(explicit=true)=>{
  if(running.current) return
  const epoch=++generation.current,expected=scope.current,expectedActor=callbacks.current.actorUserId
  let credentials=captureMenuCredentials()
  const refreshToken=credentials?.refreshToken
  running.current=true;setBusy(true)
  const sessionValid=()=>alive.current&&generation.current===epoch&&callbacks.current.actorUserId===expectedActor&&captureMenuCredentials()?.refreshToken===refreshToken
  const valid=()=>sessionValid()&&!!credentials&&menuCredentialsMatch(credentials)
  try{
   if(!credentials) {detached();return}
   if(session.current && session.current!==credentials.refreshToken){detached();return}
   let verified:MenuScope
   try{verified=await verifyMenuScope(credentials,expected,valid)}catch(error){
    if(!explicit || !isAxiosError(error) || error.response?.status!==401 || !valid())throw error
    // 明示再確認だけ既存GETのrefreshを許し、その結果は固定credentialで再検証する。
    try{await apiClient.get('/auth/me')}finally{
     const refreshed=captureMenuCredentials()
     if(!sessionValid() || !refreshed)throw new PurchaseIdentityError('本人と世帯を再確認してください')
     credentials=refreshed
    }
    verified=await verifyMenuScope(credentials,expected,valid)
   }
   if(!valid() || (callbacks.current.actorUserId!==undefined&&callbacks.current.actorUserId!==verified.actorUserId)){if(generation.current===epoch)detached();return}
   session.current=credentials.refreshToken;scope.current=verified;setVerifiedScope(verified)
   const stored=readMenuPending(verified)
   setPending(stored.kind==='pending'?stored.pending:null)
   if(stored.kind==='pending'){const result:MenuOperationOutcome={kind:'unknown',message:'前回の結果が未確認です。同じ内容で確認してください'};setOutcome(result);setMessage(result.message)}
   else if(stored.kind!=='empty'||!menuPendingAvailable()){const result:MenuOperationOutcome={kind:'blocked',message:'安全な保存を利用できません。保存済み内容は変更していません'};setOutcome(result);setMessage(result.message)}
   else {setOutcome(null);setMessage('')}
  }catch(error){if(generation.current===epoch&&alive.current){
   if(error instanceof PurchaseIdentityError || !valid()){detached();return}
   setVerifiedScope(null);setPending(null);setOutcome({kind:'blocked',message:'本人と世帯を確認できません。再確認してください'});setMessage('本人と世帯を確認できません。再確認してください')
  }}
  finally{if(generation.current===epoch&&alive.current){running.current=false;setBusy(false)}}
 },[detached])
 useEffect(()=>{alive.current=true;void recheck(false);return()=>{alive.current=false;generation.current++;running.current=false}},[options.actorUserId,recheck])
 useEffect(()=>{const check=()=>{if(!running.current)void recheck(false)};window.addEventListener('storage',check);window.addEventListener('focus',check);return()=>{window.removeEventListener('storage',check);window.removeEventListener('focus',check)}},[recheck])
 const execute=useCallback(async(input:MenuOperationInput|null):Promise<MenuOperationOutcome>=>{
  const blocked:MenuOperationOutcome={kind:'blocked',message:'前回の結果と本人・世帯を確認してください'}
  if(running.current||!scope.current) return blocked
  const expected=scope.current,epoch=++generation.current,credentials=captureMenuCredentials(),expectedActor=callbacks.current.actorUserId
  running.current=true;setBusy(true)
  const valid=()=>alive.current&&generation.current===epoch&&!!credentials&&menuCredentialsMatch(credentials)&&callbacks.current.actorUserId===expectedActor&&scope.current?.actorUserId===expected.actorUserId&&scope.current?.householdId===expected.householdId
  try{
   if(!credentials||session.current!==credentials.refreshToken)return detached()
   await verifyMenuScope(credentials,expected,valid)
   if(!valid())return generation.current===epoch?detached():blocked
   const stored=readMenuPending(expected)
   let envelope:MenuOperationEnvelope
   let recovering=false
   if(input){
    if(stored.kind!=='empty'){if(stored.kind==='pending'){setPending(stored.pending);setOutcome({kind:'unknown',message:'前回の結果を同じ内容で確認してください'});setMessage('前回の結果を同じ内容で確認してください')}return blocked}
    const saved=await saveMenuPending(expected,()=>input.kind==='register'?{kind:'register',body:{...input.inventory,menuLinkage:{requestId:crypto.randomUUID(),menus:input.menus}}}:{kind:input.kind,entryId:input.entryId,body:{requestId:crypto.randomUUID(),expectedRevision:input.mealRevision}},valid)
    if(!valid())return generation.current===epoch&&alive.current?detached():blocked
    if(saved.kind!=='saved'){if(saved.kind==='existing')setPending(saved.pending);setOutcome(blocked);setMessage(blocked.message);return blocked}
    envelope=saved.pending
   }else{
    if(stored.kind!=='pending'){setOutcome(blocked);setMessage(blocked.message);return blocked}
    envelope=stored.pending;recovering=true
   }
   setPending(envelope)
   const result=await sendMenuOperation(envelope,credentials,recovering,valid)
   if(!valid())return generation.current===epoch?detached():blocked
   if(result.kind==='success'||result.kind==='rejected'){
    const removed=await removeMenuPending(envelope,valid)
    if(!valid())return generation.current===epoch&&alive.current?detached():blocked
    if(!removed){const unknown:MenuOperationOutcome={kind:'unknown',message:'結果の確認を完了できません。同じ内容で確認してください'};setOutcome(unknown);setMessage(unknown.message);return unknown}
    setPending(null)
   }
   setOutcome(result);setMessage('message' in result?result.message:'')
   return result
  }catch(error){
   if(generation.current!==epoch||!alive.current)return blocked
   if(error instanceof PurchaseIdentityError || !valid())return detached()
   const result:MenuOperationOutcome={kind:'blocked',message:'本人と世帯を確認できません。再確認してください'};setOutcome(result);setMessage(result.message);return result
  }finally{if(generation.current===epoch&&alive.current){running.current=false;setBusy(false)}}
 },[detached])
 return {run:useCallback((input:MenuOperationInput)=>execute(input),[execute]),recover:useCallback(()=>execute(null),[execute]),invalidate:detached,recheck,pending,busy,outcome,message,verifiedScope}
}

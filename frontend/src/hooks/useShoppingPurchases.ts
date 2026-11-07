import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isAxiosError } from 'axios'
import { apiClient } from '../api/client'
import { PurchaseIdentityError, boundConfig, captureCredentials, credentialsMatch, purchaseResult, verifyPurchaseScope, type PurchaseCredentials, type PurchaseResult } from '../api/shoppingPurchases'
import { pendingAvailable, pendingKey, readPending, removePending, sameRequest, savePending, type PurchaseLine, type PurchasePending, type PurchaseScope } from '../lib/shoppingPending'
interface Options { actorUserId?: number; onSuccess: (body: PurchasePending, result: PurchaseResult) => Promise<void>; onNotApplied: () => Promise<void>; onDetached: () => void }
export type PurchaseStatus = 'checking' | 'ready' | 'sending' | 'unknown' | 'blocked' | 'corrupt' | 'notApplied' | 'refreshFailed' | 'detached' | 'refreshing' | 'notAppliedRefreshFailed'
export function useShoppingPurchases(options: Options) {
  const callbacks = useRef(options)
  useLayoutEffect(() => { callbacks.current = options }, [options])
  const [verifiedScope, setVerifiedScope] = useState<PurchaseScope | null>(null)
  const [status, setStatus] = useState<PurchaseStatus>('checking')
  const [pending, setPending] = useState<PurchasePending | null>(null)
  const [message, setMessage] = useState('')
  const scope = useRef<PurchaseScope | null>(null)
  const credentials = useRef<PurchaseCredentials | null>(null)
  const generation = useRef({ value: 0 }), running = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const alive = useRef(true)
  const previousActor = useRef(options.actorUserId)
  const detach = useCallback(() => {
    generation.current.value++; controller.current?.abort(); running.current = false
    credentials.current = null; scope.current = null
    if (!alive.current) return
    setVerifiedScope(null)
    setPending(null); setStatus('detached'); setMessage('ログイン状態が変更されました。本人と世帯を再確認してください')
    callbacks.current.onDetached()
  }, [])
  const invalidate = useCallback((snapshot: PurchaseCredentials) => {
    const latest = captureCredentials()
    if (!latest || latest.refreshToken !== snapshot.refreshToken || latest.accessToken === snapshot.accessToken || (scope.current && callbacks.current.actorUserId !== undefined && callbacks.current.actorUserId !== scope.current.actorUserId)) { detach(); return }
    generation.current.value++; controller.current?.abort(); running.current = false
    const stored = scope.current ? readPending(scope.current) : null
    setPending(stored?.kind === 'pending' ? stored.pending : null)
    setStatus('blocked'); setMessage('ログイン情報が更新されました。本人と世帯を再確認してください')
  }, [detach])
  const inspect = useCallback((verified: PurchaseScope) => {
    const stored = readPending(verified)
    if (stored.kind === 'pending') { setPending(stored.pending); setStatus('unknown'); setMessage('前回の購入結果が未確認です。元の内容で確認してください') }
    else if (stored.kind === 'empty') { setPending(null); setStatus(pendingAvailable() ? 'ready' : 'blocked'); setMessage(pendingAvailable() ? '' : '購入の安全な保存を利用できません。このブラウザでは購入を送信できません') }
    else { setPending(null); setStatus(stored.kind === 'corrupt' ? 'corrupt' : 'blocked'); setMessage('前回の購入結果を確認できません。保存済み内容は変更していません') }
  }, [])
  const recheck = useCallback(async () => {
    if (running.current) return
    if (verifiedScope && callbacks.current.actorUserId !== undefined && callbacks.current.actorUserId !== verifiedScope.actorUserId) callbacks.current.onDetached()
    const current = ++generation.current.value
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort
    const snapshot = captureCredentials()
    const expected = scope.current
    if (expected && credentials.current && snapshot?.refreshToken !== credentials.current.refreshToken) { detach(); return }
    const valid = () => alive.current && current === generation.current.value && !abort.signal.aborted && !!snapshot && credentialsMatch(snapshot)
    setStatus('checking'); setPending(null); setMessage('')
    if (!snapshot) { detach(); return }
    try {
      const verified = await verifyPurchaseScope(snapshot, expected, valid, abort.signal)
      if (!valid()) { if (current === generation.current.value && alive.current) invalidate(snapshot); return }
      if (callbacks.current.actorUserId !== undefined && verified.actorUserId !== callbacks.current.actorUserId) { detach(); return }
      credentials.current = snapshot
      scope.current = verified; setVerifiedScope(verified); inspect(verified)
    } catch (error) {
      if (current !== generation.current.value || !alive.current) return
      if (!valid()) { invalidate(snapshot); return }
      if (error instanceof PurchaseIdentityError) { detach(); return }
      setStatus('blocked'); setMessage('本人と世帯を確認できません。再確認してから購入してください')
    }
  }, [detach, inspect, invalidate, verifiedScope])
  useEffect(() => {
    alive.current = true
    const effectGeneration = generation.current
    const changedActor = previousActor.current !== undefined && previousActor.current !== options.actorUserId
    previousActor.current = options.actorUserId
    const current = ++effectGeneration.value
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    const snapshot = captureCredentials()
    credentials.current = snapshot
    scope.current = null
    const valid = () => alive.current && current === effectGeneration.value && !abort.signal.aborted && !!snapshot && credentialsMatch(snapshot)
    // Initial loading already starts in 'checking'. Only external identity results
    // change render state here; explicit user rechecks keep their immediate feedback.
    const loadInitialScope = async () => {
      try {
        const verifyInitialIdentity = async () => {
          if (!snapshot) throw new PurchaseIdentityError('購入の本人確認が必要です')
          return verifyPurchaseScope(snapshot, null, valid, abort.signal)
        }
        const verified = await verifyInitialIdentity()
        if (current !== effectGeneration.value || !alive.current) return
        if (!valid()) { invalidate(snapshot!); return }
        if (callbacks.current.actorUserId !== undefined && callbacks.current.actorUserId !== verified.actorUserId) { detach(); return }
        if (changedActor) callbacks.current.onDetached()
        scope.current = verified
        setVerifiedScope(verified)
        inspect(verified)
      } catch (error) {
        if (current !== effectGeneration.value || !alive.current) return
        if (snapshot && !valid()) { invalidate(snapshot); return }
        if (error instanceof PurchaseIdentityError) { detach(); return }
        if (changedActor) callbacks.current.onDetached()
        setVerifiedScope(null)
        setPending(null)
        setStatus('blocked')
        setMessage('本人と世帯を確認できません。再確認してから購入してください')
      }
    }
    void loadInitialScope()
    const storage = (event: StorageEvent) => {
      if (event.key === null || event.key === 'homelog.accessToken' || event.key === 'homelog.refreshToken') {
        if (credentials.current && !credentialsMatch(credentials.current)) invalidate(credentials.current)
      } else if (scope.current && event.key === pendingKey(scope.current) && !running.current) inspect(scope.current)
    }
    window.addEventListener('storage', storage)
    return () => { alive.current = false; effectGeneration.value++; controller.current?.abort(); running.current = false; window.removeEventListener('storage', storage) }
  }, [options.actorUserId, detach, inspect, invalidate])
  const execute = useCallback(async (lines: PurchaseLine[] | null) => {
    if (running.current || !scope.current || !credentials.current) return
    if (lines && !['ready', 'notApplied'].includes(status)) return
    if (!lines && !pending) return
    if (!pendingAvailable()) { setStatus('blocked'); setMessage('購入の安全な保存を利用できません。購入は送信していません'); return }
    const requestedLines = lines?.map(({ id, purchasedQuantity, expectedPurchaseRevision }) => ({ id, purchasedQuantity, expectedPurchaseRevision })) ?? null
    const expected = scope.current
    const snapshot = captureCredentials()
    if (!snapshot || snapshot.refreshToken !== credentials.current.refreshToken) { detach(); return }
    running.current = true
    const current = ++generation.current.value
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort
    const valid = () => alive.current && current === generation.current.value && !abort.signal.aborted && credentialsMatch(snapshot) && scope.current?.actorUserId === expected.actorUserId && scope.current.householdId === expected.householdId
    const invalidated = () => { if (current === generation.current.value && alive.current) invalidate(snapshot) }
    setStatus('sending'); setMessage('購入内容を確認しています…')
    let saved: PurchasePending | null = null
    try {
      await verifyPurchaseScope(snapshot, expected, valid, abort.signal)
      if (!valid()) { invalidated(); return }
      credentials.current = snapshot
      if (lines) {
        const stored = await savePending(expected, () => ({ requestId: crypto.randomUUID().toLowerCase(), items: requestedLines! }), valid, abort.signal)
        if (!valid()) { invalidated(); return }
        if (stored.kind === 'blocked') { setStatus('blocked'); setMessage('購入内容を安全に保存できませんでした。購入は送信していません'); return }
        saved = stored.pending; setPending(saved)
        if (stored.kind === 'existing') { setStatus('unknown'); setMessage('前回の購入結果を確認してください'); return }
      } else {
        const stored = readPending(expected)
        if (stored.kind !== 'pending' || !pending || !sameRequest(stored.pending, pending)) { inspect(expected); return }
        saved = stored.pending
      }
      if (!valid()) { invalidated(); return }
      let outcome
      try {
        const response = await apiClient.post('/shopping-list-items/purchases', { requestId: saved.requestId, items: saved.items }, boundConfig(snapshot, abort.signal))
        if (!valid()) { invalidated(); return }
        outcome = purchaseResult(response.status, response.data, saved)
      } catch (error) {
        if (!valid()) { invalidated(); return }
        outcome = isAxiosError(error) && error.response ? purchaseResult(error.response.status, error.response.data, saved) : { kind: 'unknown' as const }
      }
      if (!valid()) { invalidated(); return }
      if (outcome.kind === 'unknown') { setStatus('unknown'); setMessage('購入結果を確認できません。前回と同じ内容で結果を確認してください'); return }
      // Another tab may already have resolved this key and created a different purchase.
      const latest = readPending(expected)
      if (latest.kind !== 'pending' || !sameRequest(latest.pending, saved)) { inspect(expected); return }
      const removed = await removePending(saved, valid, abort.signal)
      if (!valid()) { invalidated(); return }
      const after = readPending(expected)
      if (after.kind === 'pending' && !sameRequest(after.pending, saved)) { inspect(expected); return }
      setPending(removed ? null : saved)
      if (outcome.kind === 'success') {
        setStatus('refreshing'); setMessage(removed ? '購入を反映しました' : '購入は反映済みです。保存記録の確認には前回の購入結果を確認してください')
        try {
          if (!valid()) { invalidated(); return }
          await callbacks.current.onSuccess(saved, outcome.result)
          if (!valid()) { invalidated(); return }
          setStatus(removed ? 'ready' : 'unknown')
        } catch { if (valid()) { setStatus(removed ? 'refreshFailed' : 'unknown'); setMessage('購入は反映済み。一覧を再取得してください') } else invalidated() }
      } else {
        setStatus('refreshing'); setMessage('購入は反映されていません。一覧を確認し、購入内容を再確認してください')
        try { if (!valid()) { invalidated(); return }; await callbacks.current.onNotApplied(); if (!valid()) invalidated(); else setStatus(removed ? 'notApplied' : 'unknown') }
        catch { if (valid()) { setStatus(removed ? 'notAppliedRefreshFailed' : 'unknown'); setMessage('購入は反映されていません。一覧を再取得して再確認してください') } else invalidated() }
      }
    } catch (error) {
      if (current !== generation.current.value || !alive.current) return
      if (!valid()) { invalidated(); return }
      if (error instanceof PurchaseIdentityError) { detach(); return }
      setStatus(saved ? 'unknown' : 'blocked'); setMessage(saved ? '購入結果を確認できません。前回の購入結果を確認してください' : '本人と世帯を確認できません。再確認してから購入してください')
    } finally { if (current === generation.current.value) running.current = false }
  }, [status, pending, detach, inspect, invalidate])
  const acknowledgeRefresh = () => { if (!pending && (status === 'refreshFailed' || status === 'notAppliedRefreshFailed')) { setStatus(status === 'refreshFailed' ? 'ready' : 'notApplied'); setMessage('') } }
  const changedRenderActor = verifiedScope !== null && options.actorUserId !== undefined && verifiedScope.actorUserId !== options.actorUserId
  return { status: changedRenderActor ? 'detached' as const : status, pending: changedRenderActor ? null : pending, message, acknowledgeRefresh, scope: changedRenderActor ? null : verifiedScope, confirm: (lines: PurchaseLine[]) => execute(lines), recover: () => execute(null), recheck, detach }
}

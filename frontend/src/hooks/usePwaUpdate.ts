import { useSyncExternalStore } from 'react'
import { getPwaUpdateSnapshot, subscribePwaUpdate } from '../lib/pwaUpdate'
import { getPwaUpdateSafety, subscribePwaUpdateSafety } from '../lib/pwaUpdateSafety'

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener); window.addEventListener('offline', listener)
  return () => { window.removeEventListener('online', listener); window.removeEventListener('offline', listener) }
}
export function usePwaUpdate() {
  const snapshot = useSyncExternalStore(subscribePwaUpdate, getPwaUpdateSnapshot)
  const busy = useSyncExternalStore(subscribePwaUpdateSafety, () => getPwaUpdateSafety().busy)
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine)
  return { ...snapshot, busy, online }
}

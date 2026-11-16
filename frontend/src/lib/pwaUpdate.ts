import { getPwaUpdateSafety } from './pwaUpdateSafety'

export interface PwaUpdateSnapshot { ready: boolean; applying: boolean }
let snapshot: PwaUpdateSnapshot = { ready: false, applying: false }
const listeners = new Set<() => void>()
let started = false
let registration: ServiceWorkerRegistration | null = null
let candidate: ServiceWorker | null = null
let initialController: ServiceWorker | null = null
let checkFlight: Promise<void> | null = null
let lastCheck = -Infinity
let wasOffline = false
const observed = new WeakSet<ServiceWorker>()

function publish(ready = snapshot.ready, applying = snapshot.applying): void {
  if (snapshot.ready === ready && snapshot.applying === applying) return
  snapshot = { ready, applying }; listeners.forEach(listener => listener())
}
export function subscribePwaUpdate(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function getPwaUpdateSnapshot(): PwaUpdateSnapshot { return snapshot }
function consider(worker: ServiceWorker): void {
  if (!initialController) return
  if (worker.state === 'installed' || worker.state === 'activated') { candidate = worker; publish(true) }
  else if (worker.state === 'redundant' && candidate === worker) { candidate = null; publish(false) }
}
function observe(worker: ServiceWorker | null): void {
  if (!worker || observed.has(worker)) return
  observed.add(worker)
  worker.addEventListener('statechange', () => consider(worker))
  consider(worker)
}
export function startPwaUpdate(): void {
  if (started || !import.meta.env.PROD || !('serviceWorker' in navigator)) return
  started = true
  initialController = navigator.serviceWorker.controller
  wasOffline = !navigator.onLine
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const controller = navigator.serviceWorker.controller
    // Other tabs may activate a candidate. This tab still waits for an explicit tap.
    if (initialController && controller && controller !== initialController) { candidate = controller; observe(controller); publish(true) }
  })
  const resume = () => { if (document.visibilityState === 'visible') void checkPwaUpdate('resume') }
  document.addEventListener('visibilitychange', resume)
  window.addEventListener('pageshow', resume)
  window.addEventListener('offline', () => { wasOffline = true })
  window.addEventListener('online', () => { void checkPwaUpdate('online') })
  const url = new URL('sw.js', new URL(import.meta.env.BASE_URL, location.href))
  void navigator.serviceWorker.register(url.href).then(value => {
    registration = value
    observe(value.waiting); observe(value.installing)
    value.addEventListener('updatefound', () => observe(value.installing))
    void checkPwaUpdate('startup')
  }).catch(() => { /* Leave the current screen available when registration fails. */ })
}
export async function checkPwaUpdate(reason: 'startup' | 'resume' | 'online'): Promise<void> {
  if (!navigator.onLine) { wasOffline = true; return }
  if (!registration || document.visibilityState !== 'visible') return
  if (checkFlight) return checkFlight
  const reconnect = reason === 'online' && wasOffline
  if (!reconnect && Date.now() - lastCheck < 60000) return
  lastCheck = Date.now(); wasOffline = false
  checkFlight = (async () => {
    try { await registration!.update(); observe(registration!.waiting); observe(registration!.installing) }
    catch { lastCheck = -Infinity }
  })().finally(() => { checkFlight = null })
  return checkFlight
}
function activated(worker: ServiceWorker): Promise<boolean> {
  return new Promise(resolve => {
    const finish = (success: boolean) => { clearTimeout(timer); worker.removeEventListener('statechange', changed); resolve(success) }
    const changed = () => { if (worker.state === 'activated') finish(true); else if (worker.state === 'redundant') finish(false) }
    const timer = setTimeout(() => finish(false), 15000)
    worker.addEventListener('statechange', changed)
    changed()
  })
}
export async function applyPwaUpdate(): Promise<void> {
  if (!snapshot.ready || snapshot.applying || !candidate || !navigator.onLine || getPwaUpdateSafety().busy) return
  if (getPwaUpdateSafety().editing && !window.confirm('編集中の内容は更新すると失われます。アプリを更新しますか？')) return
  if (!navigator.onLine || getPwaUpdateSafety().busy) return
  const worker = candidate
  if (worker.state !== 'installed' && worker.state !== 'activating' && worker.state !== 'activated') return
  publish(true, true)
  let reloading = false
  try {
    const completion = activated(worker)
    if (worker.state === 'installed') worker.postMessage({ type: 'SKIP_WAITING' })
    if (!await completion) return
    if (!navigator.onLine || getPwaUpdateSafety().busy) return
    location.reload()
    reloading = true
  } catch { /* Applying failure must retain this screen and its drafts. */ }
  finally { if (!reloading) publish(candidate !== null && candidate.state !== 'redundant', false) }
}

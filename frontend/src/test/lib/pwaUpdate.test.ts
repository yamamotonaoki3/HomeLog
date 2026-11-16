import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class Worker extends EventTarget {
  state: ServiceWorkerState = 'installed'
  postMessage = vi.fn()
  change(state: ServiceWorkerState) { this.state = state; this.dispatchEvent(new Event('statechange')) }
}
class Registration extends EventTarget {
  waiting: Worker | null = null
  installing: Worker | null = null
  update = vi.fn().mockResolvedValue(undefined)
}
let registration: Registration
let container: EventTarget & { controller: Worker | null; register: ReturnType<typeof vi.fn> }
let reload: ReturnType<typeof vi.fn>
async function start(waiting = true, controlled = true) {
  if (waiting) registration.waiting = new Worker()
  if (!controlled) container.controller = null
  const controller = await import('../../lib/pwaUpdate')
  controller.startPwaUpdate()
  await vi.waitFor(() => expect(container.register).toHaveBeenCalledOnce())
  await Promise.resolve(); await Promise.resolve()
  return controller
}
beforeEach(() => {
  vi.resetModules(); vi.stubEnv('PROD', true)
  registration = new Registration()
  container = Object.assign(new EventTarget(), { controller: new Worker() as Worker | null, register: vi.fn().mockResolvedValue(registration) })
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container })
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  reload = vi.fn(); vi.stubGlobal('location', { ...window.location, reload })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  document.body.innerHTML = ''
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('PWAの明示更新', () => {
  it('初回installやdownload中は通知しない', async () => {
    const pwa = await start(false, false)
    const worker = new Worker(); worker.state = 'installing'; registration.installing = worker
    registration.dispatchEvent(new Event('updatefound'))
    expect(pwa.getPwaUpdateSnapshot().ready).toBe(false)
    worker.change('installed')
    expect(pwa.getPwaUpdateSnapshot().ready).toBe(false)
  })
  it('既存waitingは取得失敗後も保持し自動reloadしない', async () => {
    registration.update.mockRejectedValue(new Error('offline'))
    const pwa = await start()
    expect(pwa.getPwaUpdateSnapshot()).toEqual({ ready: true, applying: false })
    expect(reload).not.toHaveBeenCalled()
  })
  it('offlineでは通信せずresume連発は一本にまとめる', async () => {
    const pwa = await start(false)
    registration.update.mockClear()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await pwa.checkPwaUpdate('online')
    expect(registration.update).not.toHaveBeenCalled()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    await Promise.all([pwa.checkPwaUpdate('online'), pwa.checkPwaUpdate('resume'), pwa.checkPwaUpdate('resume')])
    expect(registration.update).toHaveBeenCalledOnce()
  })
  it('編集cancelは入力・focusを保持しworkerへ送らない', async () => {
    const pwa = await start()
    document.body.innerHTML = '<form><input value="draft"></form>'
    const input = document.querySelector('input')!; input.focus()
    vi.mocked(window.confirm).mockReturnValue(false)
    await pwa.applyPwaUpdate()
    expect(input.value).toBe('draft'); expect(document.activeElement).toBe(input)
    expect(registration.waiting!.postMessage).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })
  it('保存中は適用しない', async () => {
    const pwa = await start()
    const { beginPwaBusy } = await import('../../lib/pwaUpdateSafety')
    const release = beginPwaBusy()
    await pwa.applyPwaUpdate(); release()
    expect(registration.waiting!.postMessage).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })
  it('明示承認した対象workerのactivation後に一度だけreloadする', async () => {
    const pwa = await start(), worker = registration.waiting!
    const result = pwa.applyPwaUpdate()
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(pwa.getPwaUpdateSnapshot().applying).toBe(true)
    worker.change('activated'); await result
    await pwa.applyPwaUpdate()
    expect(reload).toHaveBeenCalledOnce()
  })
  it('別tabのactivationではreloadせず次の明示tapで更新する', async () => {
    const pwa = await start(), worker = registration.waiting!
    registration.waiting = null; worker.change('activated')
    container.controller = worker; container.dispatchEvent(new Event('controllerchange'))
    expect(reload).not.toHaveBeenCalled()
    expect(pwa.getPwaUpdateSnapshot().ready).toBe(true)
    await pwa.applyPwaUpdate()
    expect(reload).toHaveBeenCalledOnce()
  })
  it.each(['redundant', 'timeout', 'busy', 'offline'])('%sではreloadせず適用中を解除する', async reason => {
    const pwa = await start(), worker = registration.waiting!
    const { beginPwaBusy } = await import('../../lib/pwaUpdateSafety')
    vi.useFakeTimers()
    const result = pwa.applyPwaUpdate()
    let release: (() => void) | undefined
    if (reason === 'busy') release = beginPwaBusy()
    if (reason === 'offline') vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    if (reason === 'timeout') await vi.advanceTimersByTimeAsync(15000)
    else worker.change(reason === 'redundant' ? 'redundant' : 'activated')
    await result; release?.()
    expect(reload).not.toHaveBeenCalled()
    expect(pwa.getPwaUpdateSnapshot().applying).toBe(false)
  })
})


it('取得中は通知せずinstalled後に更新可能にする', async () => {
  const pwa = await start(false)
  const worker = new Worker(); worker.state = 'installing'; registration.installing = worker
  registration.dispatchEvent(new Event('updatefound'))
  expect(pwa.getPwaUpdateSnapshot().ready).toBe(false)
  registration.waiting = worker; worker.change('installed')
  expect(pwa.getPwaUpdateSnapshot().ready).toBe(true)
})

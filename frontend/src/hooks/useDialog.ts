import { useEffect, useRef } from 'react'

const dialogs: HTMLElement[] = []
const tabbableSelector = 'a[href], area[href], button, input, select, textarea, [tabindex], [contenteditable="true"]'

function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected) return false
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (current.hidden || current.hasAttribute('inert') || current.getAttribute('aria-hidden') === 'true') return false
    const style = getComputedStyle(current)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
  }
  return true
}

function topDialog() {
  return dialogs.findLast(isVisible)
}

function controlsOf(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLElement>(tabbableSelector)].filter((element) =>
    element.tabIndex >= 0 && !element.matches(':disabled, input[type="hidden"]') && isVisible(element),
  )
}

// 可視ダイアログがある間は、背景の位置を保つ。
let releaseScroll: (() => void) | undefined
function lockScroll() {
  if (releaseScroll) return
  const { style } = document.body
  const properties = ['overflow', 'position', 'top', 'left', 'width'] as const
  const previous = properties.map((name) => [name, style.getPropertyValue(name), style.getPropertyPriority(name)] as const)
  const x = window.scrollX
  const y = window.scrollY
  style.overflow = 'hidden'
  style.position = 'fixed'
  style.top = `-${y}px`
  style.left = `-${x}px`
  style.width = '100%'
  releaseScroll = () => {
    for (const [name, value, priority] of previous) {
      if (value) style.setProperty(name, value, priority)
      else style.removeProperty(name)
    }
    if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y)
    releaseScroll = undefined
  }
}

// DOMを保持したまま祖先パネルが隠れる場合も、可視状態に固定を合わせる。
let visibilityObserver: MutationObserver | undefined
function syncScrollLock() {
  // 固定・復元で変更するbodyのstyleを自身で再通知しない。
  visibilityObserver?.disconnect()
  if (topDialog()) lockScroll()
  else releaseScroll?.()

  if (dialogs.length === 0) {
    visibilityObserver = undefined
    return
  }
  visibilityObserver ??= new MutationObserver(syncScrollLock)
  visibilityObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'inert', 'aria-hidden', 'class', 'style'],
  })
}

export function useDialog(onClose: () => void, initialSelector: string) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  const originRef = useRef<HTMLElement | null>(null)
  close.current = onClose
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    // StrictModeのeffect再セットアップで、元の外部起点を内部の初期操作へ取り直さない。
    const activeAtSetup = document.activeElement
    if (originRef.current === null && activeAtSetup instanceof HTMLElement && !dialog.contains(activeAtSetup)) {
      originRef.current = activeAtSetup
    }
    const origin = originRef.current
    const originalTabIndex = dialog.getAttribute('tabindex')
    if (originalTabIndex === null) dialog.tabIndex = -1
    dialogs.push(dialog)
    syncScrollLock()
    const initial = dialog.querySelector<HTMLElement>(initialSelector)
    const target = initial && !initial.matches(':disabled') && isVisible(initial) ? initial : controlsOf(dialog)[0] ?? dialog
    if (isVisible(dialog)) target.focus({ preventScroll: true })
    const keydown = (event: KeyboardEvent) => {
      if (topDialog() !== dialog) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        close.current()
        return
      }
      if (event.key !== 'Tab') return
      const controls = controlsOf(dialog)
      const index = controls.indexOf(document.activeElement as HTMLElement)
      event.preventDefault()
      event.stopImmediatePropagation()
      const nextIndex = index === -1
        ? (event.shiftKey ? controls.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
      // 背景はbody固定で保ち、Tab先へのモーダル内スクロールは許可する。
      ;(controls[nextIndex] ?? dialog).focus()
    }
    document.addEventListener('keydown', keydown, true)
    return () => {
      // useEffectのcleanup時点では自身のDOMが既に外れている場合がある。
      const wasTop = dialogs.findLast((element) => element === dialog || isVisible(element)) === dialog
      dialogs.splice(dialogs.indexOf(dialog), 1)
      document.removeEventListener('keydown', keydown, true)
      if (originalTabIndex === null) dialog.removeAttribute('tabindex')
      syncScrollLock()
      // 呼出元の復帰操作を優先し、DOM切替後に必要な場合だけ補う。
      queueMicrotask(() => {
        // StrictModeの再セットアップ後は、新しい初期フォーカスを優先する。
        if (dialogs.includes(dialog)) return
        const active = document.activeElement
        if (!wasTop || (active !== document.body && active !== null && !dialog.contains(active))) return
        const remaining = topDialog()
        if (origin && !origin.matches(':disabled') && isVisible(origin) && (!remaining || remaining.contains(origin))) {
          origin.focus({ preventScroll: true })
        } else if (remaining) {
          ;(controlsOf(remaining)[0] ?? remaining).focus({ preventScroll: true })
        }
      })
    }
  }, [initialSelector])
  return ref
}

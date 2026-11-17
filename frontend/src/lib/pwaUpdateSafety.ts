export interface PwaUpdateSafety { editing: boolean; busy: boolean }
const guards = new Set<() => PwaUpdateSafety>()
const listeners = new Set<() => void>()
let busyCount = 0

export function notifyPwaUpdateSafety(): void { listeners.forEach(listener => listener()) }
export function subscribePwaUpdateSafety(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function registerPwaUpdateGuard(read: () => PwaUpdateSafety): () => void {
  guards.add(read); notifyPwaUpdateSafety()
  return () => { guards.delete(read); notifyPwaUpdateSafety() }
}
export function beginPwaBusy(): () => void {
  busyCount++; notifyPwaUpdateSafety()
  let released = false
  return () => { if (!released) { released = true; busyCount--; notifyPwaUpdateSafety() } }
}
function visible(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
  }
  return true
}
export function getPwaUpdateSafety(): PwaUpdateSafety {
  let editing = false, busy = busyCount > 0
  guards.forEach(read => { const state = read(); editing ||= state.editing; busy ||= state.busy })
  // A visible editor is deliberately conservative, even after blur or before a change.
  const inputs = document.querySelectorAll('form input, form textarea, form select, [role="dialog"] input, [role="dialog"] textarea, [role="dialog"] select, .modal input, .modal textarea, .modal select, [contenteditable="true"]')
  for (const element of inputs) {
    if (element.closest('[role="search"]') || element.matches('input[type="search"], input[type="hidden"], input[type="button"], input[type="submit"], input[type="reset"], [readonly]')) continue
    if (visible(element)) { editing = true; break }
  }
  return { editing, busy }
}

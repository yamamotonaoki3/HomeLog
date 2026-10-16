import { useEffect, useRef } from 'react'

export function useDialog(onClose: () => void, initialSelector: string) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const dialog = ref.current!
    dialog.querySelector<HTMLElement>(initialSelector)?.focus({ preventScroll: true })
    const keydown = (event: KeyboardEvent) => {
      if (dialog.closest('[hidden]')) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return }
      if (event.key !== 'Tab') return
      const controls: HTMLElement[] = [...dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('button, input, select, textarea')].filter((element) => !element.disabled)
      const index = controls.indexOf(document.activeElement as HTMLElement)
      event.preventDefault()
      event.stopPropagation()
      const nextIndex = index === -1
        ? (event.shiftKey ? controls.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
      controls[nextIndex]?.focus()
    }
    document.addEventListener('keydown', keydown, true)
    return () => document.removeEventListener('keydown', keydown, true)
  }, [initialSelector])
  return ref
}

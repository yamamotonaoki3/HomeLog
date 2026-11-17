import { useLayoutEffect, useRef } from 'react'
import { notifyPwaUpdateSafety, registerPwaUpdateGuard, type PwaUpdateSafety } from '../lib/pwaUpdateSafety'

export function usePwaUpdateGuard(state: PwaUpdateSafety): void {
  const latest = useRef(state)
  useLayoutEffect(() => { latest.current = state; notifyPwaUpdateSafety() }, [state.editing, state.busy])
  useLayoutEffect(() => registerPwaUpdateGuard(() => latest.current), [])
}

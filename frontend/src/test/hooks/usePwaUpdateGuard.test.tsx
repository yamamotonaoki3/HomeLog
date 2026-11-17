import { renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { usePwaUpdateGuard } from '../../hooks/usePwaUpdateGuard'
import { getPwaUpdateSafety } from '../../lib/pwaUpdateSafety'

it('最新のdraft・busyを読み、unmountで登録を解除する', () => {
  const view = renderHook(state => usePwaUpdateGuard(state), { initialProps: { editing: true, busy: false } })
  expect(getPwaUpdateSafety()).toEqual({ editing: true, busy: false })
  view.rerender({ editing: false, busy: true })
  expect(getPwaUpdateSafety()).toEqual({ editing: false, busy: true })
  view.unmount()
  expect(getPwaUpdateSafety()).toEqual({ editing: false, busy: false })
})

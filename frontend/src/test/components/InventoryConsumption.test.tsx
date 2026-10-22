import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { InventoryModal } from '../../components/zaiko/InventoryModal'

const props = { categories: [{ id: 1, name: '[E2E_TEST] food', isDefault: false }], stores: [], onCategoriesChange: vi.fn(), onStoresChange: vi.fn(), onClose: vi.fn(), onSaved: vi.fn().mockResolvedValue(undefined) }
it('初回入力・Space操作・オフの消費量を送信する', async () => {
  const bodies: unknown[] = []
  server.use(http.post('/api/inventory-items', async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({}, { status: 201 }) }))
  const user = userEvent.setup()
  render(<InventoryModal {...props} />)
  await user.type(screen.getByLabelText('品名'), '[E2E_TEST] testuser_milk')
  const input = screen.getByLabelText('1日の消費量（任意）')
  expect(input).toHaveAttribute('step', '0.1')
  expect(input).toHaveAttribute('min', '0.1')
  expect(input).toHaveAttribute('max', '99999.9')
  const toggle = screen.getByRole('switch', { name: '自動消費' })
  expect(toggle).toHaveAttribute('aria-checked', 'false')
  await user.type(input, '0.2')
  expect(toggle).toHaveAttribute('aria-checked', 'true')
  toggle.focus()
  await user.keyboard(' ')
  expect(toggle).toHaveAttribute('aria-checked', 'false')
  await user.clear(input); await user.type(input, '0.3')
  expect(toggle).toHaveAttribute('aria-checked', 'false')
  await user.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(bodies).toHaveLength(1))
  expect(bodies[0]).toMatchObject({ dailyConsumption: 0.3, autoConsumptionEnabled: false })
})
it('編集の初期値・空欄化・保存失敗時の入力保持', async () => {
  server.use(http.patch('/api/inventory-items/1', () => HttpResponse.json({ message: '[E2E_TEST] failed' }, { status: 500 })))
  const user = userEvent.setup()
  render(<InventoryModal {...props} item={{ id: 1, name: '[E2E_TEST] testuser_milk', categoryId: 1, storeId: null, quantity: 1, threshold: 0, dailyConsumption: 0.2, autoConsumptionEnabled: true }} />)
  const input = screen.getByLabelText('1日の消費量（任意）')
  expect(input).toHaveValue(0.2)
  await user.clear(input)
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  expect(screen.getByRole('switch')).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('[E2E_TEST] failed')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(input).toHaveValue(null)
})

it.each(['0', '-1', '0.01', '100000'])('不正な入力%sは送信しない', async (value) => {
  let posts = 0
  server.use(http.post('/api/inventory-items', () => { posts++; return HttpResponse.json({}) }))
  const user = userEvent.setup()
  render(<InventoryModal {...props} />)
  await user.type(screen.getByLabelText('品名'), '[E2E_TEST] testuser_invalid')
  fireEvent.change(screen.getByLabelText('1日の消費量（任意）'), { target: { value } })
  fireEvent.submit(screen.getByRole('button', { name: '保存' }).closest('form')!)
  expect(await screen.findByRole('alert')).toHaveTextContent('1日の消費量は0.1〜99999.9')
  expect(posts).toBe(0)
})
it.each(['0.1', '99999.9', ''])('空欄と境界%sを送信する', async (value) => {
  const bodies: unknown[] = []
  server.use(http.post('/api/inventory-items', async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({}) }))
  const user = userEvent.setup()
  render(<InventoryModal {...props} />)
  await user.type(screen.getByLabelText('品名'), '[E2E_TEST] testuser_boundary')
  if (value) await user.type(screen.getByLabelText('1日の消費量（任意）'), value)
  await user.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(bodies).toHaveLength(1))
  expect(bodies[0]).toMatchObject({ dailyConsumption: value ? Number(value) : null, autoConsumptionEnabled: value !== '' })
})
it('保存通信中は再送信・スイッチ切替・閉じる操作を防ぐ', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let posts = 0
  server.use(http.post('/api/inventory-items', async () => { posts++; await gate; return HttpResponse.json({}) }))
  const close = vi.fn()
  const saved = vi.fn().mockResolvedValue(undefined)
  const user = userEvent.setup()
  render(<InventoryModal {...props} onClose={close} onSaved={saved} />)
  await user.type(screen.getByLabelText('品名'), '[E2E_TEST] testuser_busy')
  await user.type(screen.getByLabelText('1日の消費量（任意）'), '0.2')
  await user.click(screen.getByRole('button', { name: '保存' }))
  expect(screen.getByRole('switch')).toBeDisabled()
  expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  await user.keyboard('{Escape}')
  expect(close).not.toHaveBeenCalled()
  fireEvent.submit(screen.getByRole('button', { name: '保存' }).closest('form')!)
  release()
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
  expect(posts).toBe(1)
})
it('保存成功後の再取得失敗で保存を再送せず閉じられる', async () => {
  let posts = 0
  server.use(http.post('/api/inventory-items', () => { posts++; return HttpResponse.json({}) }))
  const close = vi.fn()
  const user = userEvent.setup()
  render(<InventoryModal {...props} onSaved={vi.fn().mockRejectedValue(new Error('[E2E_TEST] refresh'))} onClose={close} />)
  await user.type(screen.getByLabelText('品名'), '[E2E_TEST] testuser_saved')
  await user.type(screen.getByLabelText('1日の消費量（任意）'), '0.2')
  await user.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('保存しました。一覧の再取得に失敗しました')
  expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  fireEvent.submit(screen.getByRole('button', { name: '保存' }).closest('form')!)
  expect(posts).toBe(1)
  await user.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect(close).toHaveBeenCalledTimes(1)
})

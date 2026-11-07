import { apiClient } from '../../api/client'
import { AxiosError } from 'axios'
import { StrictMode } from 'react'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { InventoryPanel } from '../../components/zaiko/InventoryPanel'

const item = { id: 1, name: '[E2E_TEST] testuser_milk', categoryId: 1, storeId: null, quantity: 2, threshold: 1, dailyConsumption: null, autoConsumptionEnabled: false }
const props = { inventory: [item], categories: [{ id: 1, name: '食品', isDefault: true }], stores: [], onCategoriesChange: vi.fn(), onStoresChange: vi.fn(), onRefresh: vi.fn().mockResolvedValue(undefined), onNotify: vi.fn() }
async function expand(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: item.name + 'の詳細' }))
  return screen.getByRole('region', { name: item.name + 'の数量変更' })
}

it.each([[0, 0, true], [1, 1, true], [0.5, 1, true], [1.1, 1, false]] as const)('在庫%s/閾値%sの警告と数量を行から読み上げる', (quantity, threshold, low) => {
  render(<InventoryPanel {...props} inventory={[{ ...item, quantity, threshold }]} />)
  const row = screen.getByRole('button', { name: item.name + 'の詳細' })
  expect(row).toHaveAccessibleDescription(low ? '在庫数 ' + quantity.toFixed(1) + ' 在庫が閾値以下' : '在庫数 ' + quantity.toFixed(1))
  expect(within(row).queryByText('！') !== null).toBe(low)
  expect(screen.queryByText('閾値')).not.toBeInTheDocument()
  expect(row).toHaveAttribute('aria-expanded', 'false')
})

it('行直下に数量欄を展開し別の明示導線で詳細を開閉する', async () => {
  const user = userEvent.setup()
  render(<StrictMode><InventoryPanel {...props} /></StrictMode>)
  expect(screen.queryByRole('button', { name: item.name + 'を増やす' })).not.toBeInTheDocument()
  const region = await expand(user)
  const row = screen.getByRole('button', { name: item.name + 'の詳細' })
  expect(row).toHaveAttribute('aria-controls', region.id)
  expect(row).toHaveAttribute('aria-expanded', 'true')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  const detail = within(region).getByRole('button', { name: item.name + 'の詳細設定' })
  await user.click(detail)
  expect(screen.getByRole('dialog', { name: '在庫詳細・編集' })).toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(detail).toHaveFocus())
  await user.click(row)
  expect(screen.queryByRole('region')).not.toBeInTheDocument()
})

it.each([2.5, -0.5, 0])('増減量%sを適用時だけ相対PATCHし成功後draftを消費する', async delta => {
  const bodies: unknown[] = []
  server.use(http.patch('/api/inventory-items/1/quantity', async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({ id: 1, quantity: 2 + delta }) }))
  const user = userEvent.setup()
  render(<InventoryPanel {...props} />)
  const region = await expand(user)
  await user.type(within(region).getByLabelText('増減量'), String(delta))
  expect(bodies).toHaveLength(0)
  await user.click(within(region).getByRole('button', { name: '適用' }))
  await waitFor(() => expect(within(region).getByLabelText('増減量')).toHaveValue(''))
  expect(bodies).toEqual([{ delta }])
  await user.click(within(region).getByRole('button', { name: '適用' }))
  expect(bodies).toHaveLength(1)
})

it.each(['', '0.01', '100000', '-100000', 'Infinity', 'abc'])('不正増減量[%s]は要求しない', async value => {
  let count = 0
  server.use(http.patch('/api/inventory-items/1/quantity', () => { count++; return HttpResponse.json({ quantity: 2 }) }))
  const user = userEvent.setup()
  render(<InventoryPanel {...props} />)
  const region = await expand(user)
  fireEvent.change(within(region).getByLabelText('増減量'), { target: { value } })
  await user.click(within(region).getByRole('button', { name: '適用' }))
  expect(within(region).getByRole('alert')).toHaveTextContent('増減量')
  expect(count).toBe(0)
})

it('pending中の適用/Enter/±競合を一要求に制限する', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let count = 0
  server.use(http.patch('/api/inventory-items/1/quantity', async () => { count++; await gate; return HttpResponse.json({ quantity: 3 }) }))
  const user = userEvent.setup()
  render(<InventoryPanel {...props} />)
  const region = await expand(user)
  await user.type(within(region).getByLabelText('増減量'), '1')
  await user.click(within(region).getByRole('button', { name: '適用' }))
  expect(within(region).getByRole('button', { name: item.name + 'を増やす' })).toBeDisabled()
  fireEvent.submit(within(region).getByRole('button', { name: '適用' }).closest('form')!)
  expect(count).toBe(1)
  release()
  await waitFor(() => expect(within(region).getByLabelText('増減量')).toHaveValue(''))
})

it.each([400, 401])('確実拒否%sではdraftを保持し明示再試行できる', async status => {
  let count = 0
  server.use(http.patch('/api/inventory-items/1/quantity', () => { count++; return count === 1 && status !== 401 ? HttpResponse.json({ message: '[E2E_TEST] rejected' }, { status }) : HttpResponse.json({ quantity: 3 }) }))
  const originalPatch = apiClient.patch.bind(apiClient)
  const intercepted = status === 401 ? vi.spyOn(apiClient, 'patch').mockRejectedValueOnce(new AxiosError('rejected', undefined, undefined, undefined, { status: 401, data: { message: '[E2E_TEST] rejected' } } as never)).mockImplementation(originalPatch) : undefined
  const user = userEvent.setup()
  render(<InventoryPanel {...props} />)
  const region = await expand(user)
  await user.type(within(region).getByLabelText('増減量'), '1')
  await user.click(within(region).getByRole('button', { name: '適用' }))
  await waitFor(() => expect(within(region).getByRole('button', { name: '適用' })).toBeEnabled())
  expect(within(region).getByLabelText('増減量')).toHaveValue('1')
  await user.click(within(region).getByRole('button', { name: '適用' }))
  await waitFor(() => expect(count).toBe(status === 401 ? 1 : 2))
  intercepted?.mockRestore()
})

it.each([404, 403, 408, 500, 'network', 'auth-refresh'] as const)('未保証%sは結果不明を保持し再開/GET後も±と同draftを再送しない', async status => {
  let count = 0
  const refresh = status === 500 ? vi.fn().mockRejectedValue(new Error('[E2E_TEST] GET failed')) : vi.fn().mockResolvedValue(undefined)
  server.use(http.patch('/api/inventory-items/1/quantity', () => { count++; return status === 'network' ? HttpResponse.error() : HttpResponse.json({ message: '[E2E_TEST] uncertain' }, { status: status === 'auth-refresh' ? 401 : status }) }))
  const user = userEvent.setup()
  const view = render(<InventoryPanel {...props} onRefresh={refresh} />)
  let region = await expand(user)
  await user.type(within(region).getByLabelText('増減量'), '1')
  await user.click(within(region).getByRole('button', { name: '適用' }))
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  expect(within(region).getByRole('alert')).toHaveTextContent('結果を確認できません')
  await user.click(screen.getByRole('button', { name: item.name + 'の詳細' }))
  region = await expand(user)
  view.rerender(<InventoryPanel {...props} onRefresh={refresh} inventory={[{ ...item, quantity: 3 }]} />)
  expect(within(region).getByRole('alert')).toHaveTextContent('結果を確認できません')
  expect(within(region).getByRole('button', { name: '適用' })).toBeDisabled()
  expect(within(region).getByRole('button', { name: item.name + 'を増やす' })).toBeDisabled()
  await user.click(within(region).getByRole('button', { name: item.name + 'の詳細設定' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByRole('alert')).toHaveTextContent('結果を確認できません')
  expect(within(dialog).getByRole('button', { name: item.name + 'を増やす' })).toBeDisabled()
  await user.keyboard('{Escape}')
  expect(count).toBe(1)
})

it('既知成功のGET失敗は適用済みとしてdraftを消費し結果不明にしない', async () => {
  let count = 0
  const notify = vi.fn()
  server.use(http.patch('/api/inventory-items/1/quantity', () => { count++; return HttpResponse.json({ quantity: 3 }) }))
  const user = userEvent.setup()
  render(<InventoryPanel {...props} onRefresh={vi.fn().mockRejectedValue(new Error('GET failed'))} onNotify={notify} />)
  const region = await expand(user)
  await user.type(within(region).getByLabelText('増減量'), '1')
  await user.click(within(region).getByRole('button', { name: '適用' }))
  await waitFor(() => expect(notify).toHaveBeenCalledWith('在庫個数を更新しました。一覧の再取得に失敗しました'))
  expect(within(region).getByLabelText('増減量')).toHaveValue('')
  expect(within(region).queryByText(/結果を確認できません/)).not.toBeInTheDocument()
  expect(count).toBe(1)
})

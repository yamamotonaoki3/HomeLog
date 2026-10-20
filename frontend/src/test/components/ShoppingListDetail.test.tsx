import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { it, expect, vi } from 'vitest'
import { ShoppingListPanel } from '../../components/zaiko/ShoppingListPanel'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'

const inventory = [1, 2].map((id) => ({ id, name: `testuser_品目${id}`, categoryId: 1, storeId: null, quantity: 0, threshold: 10, dailyConsumption: null, autoConsumptionEnabled: false }))
const shopping = inventory.map((item) => ({ id: item.id + 10, inventoryItemId: item.id, name: item.name, isManual: false, purchased: false, purchasedQuantity: 0, price: null }))
const props = { shopping, inventory, categories: [{ id: 1, name: '食品', isDefault: true }], stores: [], sort: 'store' as const, onSortChange: vi.fn(), onRefresh: vi.fn().mockResolvedValue(undefined), onNotify: vi.fn() }

it('複数品目の入力を保持し、正の数量だけ一度送信して通信中の競合を防ぐ', async () => {
  const user = userEvent.setup()
  const bodies: unknown[] = []
  let release!: () => void
  const blocked = new Promise<void>((resolve) => { release = resolve })
  server.use(http.post('/api/shopping-list-items/update', async ({ request }) => { bodies.push(await request.json()); await blocked; return HttpResponse.json({}) }))
  render(<ShoppingListPanel {...props} />)
  for (const item of shopping) {
    await user.click(screen.getByRole('button', { name: `${item.name}の詳細` }))
    await user.click(screen.getByRole('button', { name: `${item.name}の購入個数を増やす` }))
    await user.click(screen.getByRole('button', { name: '閉じる' }))
  }
  expect(bodies).toHaveLength(0)
  const update = screen.getByRole('button', { name: '更新' })
  await user.dblClick(update)
  await user.click(screen.getByRole('button', { name: `${shopping[0].name}の詳細` }))
  expect(screen.getByRole('button', { name: `${shopping[0].name}を削除` })).toBeDisabled()
  expect(screen.getByRole('button', { name: `${shopping[0].name}の購入個数を増やす` })).toBeDisabled()
  await user.tab()
  expect(screen.getByRole('button', { name: '閉じる' })).toHaveFocus()
  expect(bodies).toEqual([{ items: [{ id: 11, purchasedQuantity: 1 }, { id: 12, purchasedQuantity: 1 }] }])
  release()
  await waitFor(() => expect(update).toBeEnabled())
  expect(screen.getByRole('dialog').querySelector('.qty-value')).toHaveTextContent(/^0$/)
})

it('購入失敗で入力を保持し、成功後の再取得失敗ではクリアして購入を再送しない', async () => {
  const user = userEvent.setup()
  let posts = 0
  server.use(http.post('/api/shopping-list-items/update', () => { posts++; return HttpResponse.json({ message: 'testuser_失敗' }, { status: 500 }) }))
  const notify = vi.fn()
  render(<ShoppingListPanel {...props} onNotify={notify} onRefresh={vi.fn().mockRejectedValue(new Error('refresh'))} />)
  await user.click(screen.getByRole('button', { name: `${shopping[0].name}の詳細` }))
  await user.click(screen.getByRole('button', { name: `${shopping[0].name}の購入個数を増やす` }))
  await user.click(screen.getByRole('button', { name: '閉じる' }))
  await user.click(screen.getByRole('button', { name: '更新' }))
  await waitFor(() => expect(notify).toHaveBeenCalledWith('testuser_失敗'))
  expect(within(screen.getByRole('button', { name: `${shopping[0].name}の詳細` })).getByText('1')).toBeInTheDocument()
  server.use(http.post('/api/shopping-list-items/update', () => { posts++; return HttpResponse.json({}) }))
  await user.click(screen.getByRole('button', { name: '更新' }))
  await waitFor(() => expect(notify).toHaveBeenCalledWith('在庫に反映しました。一覧の再取得に失敗しました'))
  await user.click(screen.getByRole('button', { name: '更新' }))
  expect(posts).toBe(2)
  expect(notify).toHaveBeenCalledWith('購入個数を入力してください')
})

it('削除失敗は詳細と入力を保持し、成功時は対象だけ破棄して追加へ戻す', async () => {
  const user = userEvent.setup()
  const notify = vi.fn()
  const { rerender } = render(<ShoppingListPanel {...props} onNotify={notify} />)
  for (const item of shopping) {
    await user.click(screen.getByRole('button', { name: `${item.name}の詳細` }))
    await user.click(screen.getByRole('button', { name: `${item.name}の購入個数を増やす` }))
    await user.click(screen.getByRole('button', { name: '閉じる' }))
  }
  server.use(http.delete('/api/shopping-list-items/11', () => HttpResponse.json({ message: 'testuser_削除失敗' }, { status: 500 })))
  await user.click(screen.getByRole('button', { name: `${shopping[0].name}の詳細` }))
  await user.click(screen.getByRole('button', { name: `${shopping[0].name}を削除` }))
  await waitFor(() => expect(notify).toHaveBeenCalledWith('testuser_削除失敗'))
  expect(screen.getByRole('dialog').querySelector('.qty-value')).toHaveTextContent(/^1$/)
  server.use(http.delete('/api/shopping-list-items/11', () => new HttpResponse(null, { status: 204 })))
  await user.click(screen.getByRole('button', { name: `${shopping[0].name}を削除` }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: '品目を手動追加' })).toHaveFocus()
  rerender(<ShoppingListPanel {...props} shopping={[shopping[1]]} />)
  expect(within(screen.getByRole('button', { name: `${shopping[1].name}の詳細` })).getByText('1')).toBeInTheDocument()
  rerender(<ShoppingListPanel {...props} />)
  await user.click(screen.getByRole('button', { name: `${shopping[0].name}の詳細` }))
  expect(screen.getByRole('dialog').querySelector('.qty-value')).toHaveTextContent(/^0$/)
})

it('最新props・対象消失・背景クリック・hidden中のキー操作を扱う', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<div><button>外部</button><ShoppingListPanel {...props} /></div>)
  await user.click(screen.getByRole('button', { name: `${shopping[0].name}の詳細` }))
  rerender(<div><button>外部</button><ShoppingListPanel {...props} shopping={[{ ...shopping[0], price: 9999999999 }]} /></div>)
  expect(within(screen.getByRole('dialog')).getByText('9,999,999,999円')).toBeInTheDocument()
  await user.click(within(screen.getByRole('dialog')).getByText('食品'))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('dialog').parentElement!)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.keyboard(' ')
  const panel = screen.getByTestId('shopping-panel')
  panel.hidden = true
  const outside = screen.getByRole('button', { name: '外部' })
  outside.focus()
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  outside.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
  panel.hidden = false
  rerender(<div><button>外部</button><ShoppingListPanel {...props} shopping={[]} /></div>)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '品目を手動追加' })).toHaveFocus()
})

it('3列から詳細で購入個数を入力し、閉じても保持して一括確定する', async () => {
  const user = userEvent.setup()
  render(<ShoppingListPanel shopping={[{ id: 10, inventoryItemId: 1, name: 'testuser_牛乳', isManual: true, purchased: false, purchasedQuantity: 0, price: 0 }]} inventory={[{ id: 1, name: 'testuser_牛乳', categoryId: 1, storeId: null, quantity: 0, threshold: 1, dailyConsumption: null, autoConsumptionEnabled: false }]} categories={[{ id: 1, name: '食品', isDefault: true }]} stores={[]} sort="store" onSortChange={vi.fn()} onRefresh={vi.fn()} onNotify={vi.fn()} />)
  const row = screen.getByRole('button', { name: 'testuser_牛乳の詳細' })
  expect(row.children).toHaveLength(3)
  expect(row.querySelector('button,input')).toBeNull()
  await user.click(within(row).getByText('0'))
  const dialog = screen.getByRole('dialog', { name: '買い物詳細' })
  expect(within(dialog).getByText('0円')).toBeInTheDocument()
  expect(within(dialog).getByText('なし')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '閉じる' })).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'testuser_牛乳の購入個数を減らす' }))
  expect(dialog.querySelector('.qty-value')).toHaveTextContent(/^0$/)
  await user.click(screen.getByRole('button', { name: 'testuser_牛乳の購入個数を増やす' }))
  await user.keyboard('{Escape}')
  expect(row).toHaveFocus()
  expect(within(row).getByText('1')).toBeInTheDocument()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('dialog').querySelector('.qty-value')).toHaveTextContent(/^1$/)
})

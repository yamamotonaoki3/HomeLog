import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { it, expect, vi } from 'vitest'
import { ShoppingListPanel } from '../../components/zaiko/ShoppingListPanel'

const inventory = [
  { id: 1, name: 'testuser_牛乳', categoryId: 1, storeId: null, quantity: 0.5, threshold: 1, dailyConsumption: null, autoConsumptionEnabled: false, price: null },
  { id: 2, name: 'testuser_卵', categoryId: 1, storeId: null, quantity: 3, threshold: 4, dailyConsumption: null, autoConsumptionEnabled: false, price: null },
]
const shopping = inventory.map((item) => ({ id: item.id + 10, inventoryItemId: item.id, name: item.name, isManual: false, purchased: false, purchasedQuantity: 0, price: null }))
const props = { shopping, inventory, categories: [{ id: 1, name: '食品', isDefault: true }], stores: [], sort: 'name' as const, onSortChange: vi.fn(), onRefresh: vi.fn().mockResolvedValue(undefined), onNotify: vi.fn() }

it('見出しに「在庫」列があり、各行に現在の在庫数を小数点第一位で表示する', () => {
  render(<ShoppingListPanel {...props} />)
  const heading = document.querySelector('.shopping-list-grid.list-row-heading') as HTMLElement
  expect([...heading.children].map((cell) => cell.textContent)).toEqual(['品名', '買う店', '在庫', '購入個数'])
  expect(within(screen.getByRole('button', { name: 'testuser_牛乳の詳細' })).getByText('0.5')).toBeInTheDocument()
  expect(within(screen.getByRole('button', { name: 'testuser_卵の詳細' })).getByText('3.0')).toBeInTheDocument()
})

it('在庫の数量が更新されると、買い物リストの在庫表示も更新後の値になる', () => {
  const { rerender } = render(<ShoppingListPanel {...props} />)
  const updated = inventory.map((item) => (item.id === 2 ? { ...item, quantity: 5 } : item))
  rerender(<ShoppingListPanel {...props} inventory={updated} />)
  expect(within(screen.getByRole('button', { name: 'testuser_卵の詳細' })).getByText('5.0')).toBeInTheDocument()
})

it('詳細モーダルに現在の在庫を表示する', async () => {
  const user = userEvent.setup()
  render(<ShoppingListPanel {...props} />)
  await user.click(screen.getByRole('button', { name: 'testuser_牛乳の詳細' }))
  const dialog = screen.getByRole('dialog', { name: '買い物詳細' })
  expect(within(dialog).getByText('現在の在庫')).toBeInTheDocument()
  expect(within(dialog).getByText('0.5')).toBeInTheDocument()
})

it('在庫情報が見つからない品目は「－」を表示する', () => {
  render(<ShoppingListPanel {...props} inventory={[inventory[1]]} />)
  expect(within(screen.getByRole('button', { name: 'testuser_牛乳の詳細' })).getByText('－')).toBeInTheDocument()
})

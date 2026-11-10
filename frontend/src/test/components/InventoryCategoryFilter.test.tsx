import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { InventoryPanel } from '../../components/zaiko/InventoryPanel'

const categories = [{ id: 1, name: '野菜', isDefault: true }, { id: 2, name: '乳製品', isDefault: true }, { id: 3, name: '肉', isDefault: true }]
const inventory = [
  { id: 1, name: 'にんじん', categoryId: 1, quantity: 3, threshold: 1 },
  { id: 2, name: '牛乳', categoryId: 2, quantity: 2, threshold: 1 },
  { id: 3, name: '小松菜', categoryId: 1, quantity: 4, threshold: 1 },
].map(item => ({ ...item, storeId: null, dailyConsumption: null, autoConsumptionEnabled: false }))

function props() {
  return { inventory, categories, stores: [], onCategoriesChange: vi.fn(), onStoresChange: vi.fn(), onRefresh: vi.fn(), onNotify: vi.fn() }
}

it('すべてを既定にし、カテゴリーとキーワードをANDで絞り込む', async () => {
  render(<InventoryPanel {...props()} />)
  const user = userEvent.setup()
  const filter = screen.getByRole('group', { name: 'カテゴリーで絞り込み' })
  const choose = (name: string) => user.click(within(filter).getByRole('radio', { name }))
  expect(within(filter).getByRole('radio', { name: 'すべて' })).toBeChecked()
  expect(within(filter).getAllByRole('radio').map(radio => radio.closest('label')?.textContent)).toEqual(['すべて', '野菜', '乳製品', '肉'])
  expect(screen.getAllByRole('button', { name: /の詳細$/ })).toHaveLength(3)
  await choose('野菜')
  expect(screen.getAllByRole('button', { name: /の詳細$/ })).toHaveLength(2)
  expect(screen.queryByRole('button', { name: '牛乳の詳細' })).not.toBeInTheDocument()
  await user.type(screen.getByRole('searchbox', { name: '商品を探す' }), 'ニンジン')
  expect(screen.getByRole('button', { name: 'にんじんの詳細' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '小松菜の詳細' })).not.toBeInTheDocument()
  await choose('乳製品')
  expect(screen.getByText('該当する品目がありません')).toBeInTheDocument()
  await user.clear(screen.getByRole('searchbox', { name: '商品を探す' }))
  expect(screen.getByRole('button', { name: '牛乳の詳細' })).toBeInTheDocument()
  await choose('すべて')
  expect(screen.getAllByRole('button', { name: /の詳細$/ })).toHaveLength(3)
})

it('品目のないカテゴリーを選ぶと0件を表示し、元データを変更しない', async () => {
  const data = props()
  render(<InventoryPanel {...data} />)
  await userEvent.setup().click(within(screen.getByRole('group', { name: 'カテゴリーで絞り込み' })).getByRole('radio', { name: '肉' }))
  expect(screen.getByText('該当する品目がありません')).toBeInTheDocument()
  expect(within(screen.getByRole('group', { name: 'カテゴリーで絞り込み' })).getByRole('radio', { name: '肉' })).toBeChecked()
  expect(data.inventory).toHaveLength(3)
  expect(data.onRefresh).not.toHaveBeenCalled()
})

it('選択カテゴリーがなくなったらすべてに戻り、再登場しても勝手に絞り込まない', async () => {
  const data = props()
  const { rerender } = render(<InventoryPanel {...data} />)
  const filter = screen.getByRole('group', { name: 'カテゴリーで絞り込み' })
  const all = () => within(filter).getByRole('radio', { name: 'すべて' })
  await userEvent.setup().click(within(filter).getByRole('radio', { name: '野菜' }))
  rerender(<InventoryPanel {...data} categories={[categories[1]]} />)
  await waitFor(() => expect(all()).toBeChecked())
  expect(screen.getAllByRole('button', { name: /の詳細$/ })).toHaveLength(3)
  rerender(<InventoryPanel {...data} />)
  expect(all()).toBeChecked()
})

it('選択中のカテゴリーのまま品目が更新されれば最新の内容で絞り込む', async () => {
  const data = props()
  const { rerender } = render(<InventoryPanel {...data} />)
  await userEvent.setup().click(within(screen.getByRole('group', { name: 'カテゴリーで絞り込み' })).getByRole('radio', { name: '野菜' }))
  rerender(<InventoryPanel {...data} inventory={data.inventory.map(item => item.id === 1 ? { ...item, categoryId: 2 } : item)} />)
  expect(screen.getAllByRole('button', { name: /の詳細$/ })).toHaveLength(1)
  expect(screen.getByRole('button', { name: '小松菜の詳細' })).toBeInTheDocument()
})

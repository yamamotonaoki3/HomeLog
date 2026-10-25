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
  const filter = screen.getByRole('combobox', { name: 'カテゴリーで絞り込み' })
  expect(filter).toHaveValue('')
  expect(screen.getAllByRole('button', { name: /の詳細$/ })).toHaveLength(3)
  await user.selectOptions(filter, '1')
  expect(screen.getAllByRole('button', { name: /の詳細$/ })).toHaveLength(2)
  expect(screen.queryByRole('button', { name: '牛乳の詳細' })).not.toBeInTheDocument()
  await user.type(screen.getByRole('searchbox', { name: 'キーワード検索' }), 'ニンジン')
  expect(screen.getByRole('button', { name: 'にんじんの詳細' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '小松菜の詳細' })).not.toBeInTheDocument()
  await user.selectOptions(filter, '2')
  expect(screen.getByText('該当する品目がありません')).toBeInTheDocument()
  await user.clear(screen.getByRole('searchbox', { name: 'キーワード検索' }))
  expect(screen.getByRole('button', { name: '牛乳の詳細' })).toBeInTheDocument()
  await user.selectOptions(filter, '')
  expect(screen.getAllByRole('button', { name: /の詳細$/ })).toHaveLength(3)
})

it('品目のないカテゴリーを選ぶと0件を表示し、元データを変更しない', async () => {
  const data = props()
  render(<InventoryPanel {...data} />)
  await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'カテゴリーで絞り込み' }), '3')
  expect(screen.getByText('該当する品目がありません')).toBeInTheDocument()
  expect(within(screen.getByRole('combobox', { name: 'カテゴリーで絞り込み' })).getByRole('option', { name: 'すべて' })).toBeInTheDocument()
  expect(data.inventory).toHaveLength(3)
  expect(data.onRefresh).not.toHaveBeenCalled()
})

it('選択カテゴリーがなくなったらすべてに戻り、再登場しても勝手に絞り込まない', async () => {
  const data = props()
  const { rerender } = render(<InventoryPanel {...data} />)
  const filter = screen.getByRole('combobox', { name: 'カテゴリーで絞り込み' })
  await userEvent.setup().selectOptions(filter, '1')
  rerender(<InventoryPanel {...data} categories={[categories[1]]} />)
  await waitFor(() => expect(filter).toHaveValue(''))
  expect(screen.getAllByRole('button', { name: /の詳細$/ })).toHaveLength(3)
  rerender(<InventoryPanel {...data} />)
  expect(filter).toHaveValue('')
})

it('選択中のカテゴリーのまま品目が更新されれば最新の内容で絞り込む', async () => {
  const data = props()
  const { rerender } = render(<InventoryPanel {...data} />)
  await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'カテゴリーで絞り込み' }), '1')
  rerender(<InventoryPanel {...data} inventory={data.inventory.map(item => item.id === 1 ? { ...item, categoryId: 2 } : item)} />)
  expect(screen.getAllByRole('button', { name: /の詳細$/ })).toHaveLength(1)
  expect(screen.getByRole('button', { name: '小松菜の詳細' })).toBeInTheDocument()
})

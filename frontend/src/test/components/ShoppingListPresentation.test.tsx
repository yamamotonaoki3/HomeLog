import { shoppingEnvironment } from '../shoppingEnvironment'
shoppingEnvironment()
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ShoppingListPanel } from '../../components/zaiko/ShoppingListPanel'

// 追加画像資料06に合わせた、買い物リストの見た目に関わる構成(#471)。
const stores = [{ id: 1, name: '[E2E_TEST] store A' }]
const inventory = [
  { id: 1, name: 'testuser_牛乳', storeId: 1, quantity: 0.5 },
  { id: 2, name: 'testuser_卵', storeId: 1, quantity: 3 },
  { id: 3, name: 'testuser_洗剤', storeId: null, quantity: 0 },
].map(item => ({ ...item, categoryId: 1, threshold: 4, dailyConsumption: null, autoConsumptionEnabled: false, price: null }))
const shopping = inventory.map(item => ({ id: item.id + 10, inventoryItemId: item.id, name: item.name, isManual: false, purchased: false, purchasedQuantity: 0, plannedQuantity: 1, purchaseRevision: 0, price: null }))
function props() {
  return { shopping, inventory, stores, categories: [{ id: 1, name: '食品', isDefault: true }], sort: 'store' as const, active: true, onSortChange: vi.fn(), onRefresh: vi.fn().mockResolvedValue(undefined), onNotify: vi.fn() }
}

it('タイトルの補足と検索のラベルを表示し、追加と並び替えの名前は変えない', () => {
  render(<ShoppingListPanel {...props()} />)
  expect(screen.getByRole('heading', { level: 2, name: '買い物リスト' })).toBeInTheDocument()
  expect(screen.getByText('店舗ごとにまとめて購入を管理')).toBeInTheDocument()
  expect(screen.getByRole('searchbox', { name: '商品を探す' })).toHaveAttribute('placeholder', '商品名で検索')
  expect(screen.getByRole('button', { name: '品目を追加' })).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: '並び替え' })).toHaveValue('store')
})

it('店舗ごとの見出しに件数を添え、1品目を1つのリスト項目にする', () => {
  render(<ShoppingListPanel {...props()} />)
  const group = screen.getByRole('region', { name: '[E2E_TEST] store Aの買い物' })
  expect(within(group).getByRole('heading', { level: 3, name: '[E2E_TEST] store A' })).toBeInTheDocument()
  expect(within(group).getByText('2件')).toBeInTheDocument()
  const rows = within(group).getAllByRole('listitem')
  expect(rows).toHaveLength(2)
  expect(within(rows[0]).getByRole('checkbox', { name: 'testuser_牛乳を購入済みにする' })).toBeInTheDocument()
  expect(within(rows[0]).getByRole('button', { name: 'testuser_牛乳の詳細' })).toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: '店舗未指定の買い物' })).getByText('1件')).toBeInTheDocument()
})

it('固定欄にチェック済みの件数を表示し、ボタンの名前は「購入を反映」のまま', async () => {
  const user = userEvent.setup()
  render(<ShoppingListPanel {...props()} />)
  expect(screen.getByText('購入済み 0件')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '購入を反映' })).toBeDisabled()
  await user.click(screen.getByRole('checkbox', { name: 'testuser_牛乳を購入済みにする' }))
  expect(screen.getByText('購入済み 1件')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '購入を反映' })).toBeEnabled()
})

it('購入内容の確認は品名と数量を一覧にし、戻る・反映の順に並べる', async () => {
  const user = userEvent.setup()
  render(<ShoppingListPanel {...props()} />)
  await user.click(screen.getByRole('checkbox', { name: 'testuser_牛乳を購入済みにする' }))
  await user.click(screen.getByRole('button', { name: '購入を反映' }))
  const dialog = screen.getByRole('dialog', { name: '購入内容の確認' })
  expect(within(dialog).getByText('反映前の確認')).toBeInTheDocument()
  const lines = within(dialog).getAllByRole('listitem')
  expect(lines).toHaveLength(1)
  expect(lines[0]).toHaveTextContent('testuser_牛乳')
  const back = within(dialog).getByRole('button', { name: '戻る' })
  const confirm = within(dialog).getByRole('button', { name: 'この内容で購入を反映' })
  expect(back.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

import { shoppingEnvironment } from '../shoppingEnvironment'
shoppingEnvironment()
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
import { ShoppingListPanel } from '../../components/zaiko/ShoppingListPanel'

// #485: 行には購入数だけを表示し、その場の－／＋で変える。
const inventory = [
  { id: 1, name: 'testuser_牛乳', quantity: 0.5 },
  { id: 2, name: 'testuser_卵', quantity: 3 },
].map(item => ({ ...item, storeId: null, categoryId: 1, threshold: 4, dailyConsumption: null, autoConsumptionEnabled: false, price: null }))
const shopping = [
  { id: 11, inventoryItemId: 1, name: 'testuser_牛乳', plannedQuantity: 1, purchaseRevision: 0 },
  { id: 12, inventoryItemId: 2, name: 'testuser_卵', plannedQuantity: 3, purchaseRevision: 2 },
].map(item => ({ ...item, isManual: true, purchased: false, purchasedQuantity: 0, price: null }))
function props() {
  return { shopping, inventory, stores: [], categories: [{ id: 1, name: '食品', isDefault: true }], sort: 'store' as const, active: true, onSortChange: vi.fn(), onRefresh: vi.fn().mockResolvedValue(undefined), onNotify: vi.fn() }
}
const group = (name: string) => screen.getByRole('group', { name: name + 'の購入数' })
const count = (name: string) => within(group(name)).getByRole('status')
const plus = (name: string) => within(group(name)).getByRole('button', { name: name + 'の購入数を1増やす' })
const minus = (name: string) => within(group(name)).getByRole('button', { name: name + 'の購入数を1減らす' })
const checkbox = (name: string) => screen.getByRole('checkbox', { name: name + 'を購入済みにする' })

it('行には在庫と購入数だけを表示し、購入数の初期値は予定数にする', () => {
  render(<ShoppingListPanel {...props()} />)
  const row = screen.getByRole('button', { name: 'testuser_牛乳の詳細' })
  expect(row).toHaveTextContent('在庫 0.5')
  expect(row).not.toHaveTextContent('予定')
  expect(row).not.toHaveTextContent('実購入')
  expect(group('testuser_牛乳')).toHaveTextContent('購入数')
  expect(count('testuser_牛乳')).toHaveTextContent('1')
  expect(count('testuser_卵')).toHaveTextContent('3')
  // 行ボタン(詳細を開く)の中に操作部品を入れない。－／＋は同じリスト項目の中で行ボタンの外に置く。
  expect(row.querySelector('button, input')).toBeNull()
  expect(row.closest('li')).toContainElement(group('testuser_牛乳'))
  expect(row).not.toContainElement(group('testuser_牛乳'))
  expect(row.querySelectorAll(':scope > span')).toHaveLength(2)
})

it('未チェックの行で＋を押すと、予定数から1増えてチェックが付き、その数で購入を反映する', async () => {
  const user = userEvent.setup()
  const bodies: { requestId: string; items: unknown[] }[] = []
  server.use(http.post('/api/shopping-list-items/purchases', async ({ request }) => {
    const body = await request.json() as { requestId: string; items: unknown[] }
    bodies.push(body)
    return HttpResponse.json({ requestId: body.requestId, updatedInventoryItems: [{ id: 2, quantity: 7 }], removedShoppingListItemIds: [12], remainingShoppingListItems: [] })
  }))
  render(<ShoppingListPanel {...props()} />)
  expect(checkbox('testuser_卵')).not.toBeChecked()
  await user.click(plus('testuser_卵'))
  expect(count('testuser_卵')).toHaveTextContent('4')
  expect(checkbox('testuser_卵')).toBeChecked()
  // 触っていない行は購入にならない。
  expect(checkbox('testuser_牛乳')).not.toBeChecked()
  expect(screen.getByText('購入済み 1件')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '購入を反映' }))
  const dialog = screen.getByRole('dialog', { name: '購入内容の確認' })
  expect(within(dialog).getAllByRole('listitem')).toHaveLength(1)
  expect(dialog).toHaveTextContent('testuser_卵')
  expect(dialog).toHaveTextContent('4')
  expect(bodies).toHaveLength(0)
  await user.click(within(dialog).getByRole('button', { name: 'この内容で購入を反映' }))
  await waitFor(() => expect(bodies).toHaveLength(1))
  expect(bodies[0].items).toEqual([{ id: 12, purchasedQuantity: 4, expectedPurchaseRevision: 2 }])
})

it('－は0で止まり、0の行は購入に含めない', async () => {
  const user = userEvent.setup()
  render(<ShoppingListPanel {...props()} />)
  await user.click(minus('testuser_牛乳'))
  expect(count('testuser_牛乳')).toHaveTextContent('0')
  expect(checkbox('testuser_牛乳')).toBeChecked()
  expect(minus('testuser_牛乳')).toBeDisabled()
  expect(screen.getByText('購入済み 0件')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '購入を反映' })).toBeDisabled()
  await user.click(plus('testuser_牛乳'))
  expect(count('testuser_牛乳')).toHaveTextContent('1')
  expect(minus('testuser_牛乳')).toBeEnabled()
  expect(screen.getByRole('button', { name: '購入を反映' })).toBeEnabled()
})

it('チェックだけ付けると予定数が購入数になり、チェックを外すと初期値の表示に戻る', async () => {
  const user = userEvent.setup()
  render(<ShoppingListPanel {...props()} />)
  await user.click(checkbox('testuser_卵'))
  expect(count('testuser_卵')).toHaveTextContent('3')
  await user.click(plus('testuser_卵'))
  await user.click(plus('testuser_卵'))
  expect(count('testuser_卵')).toHaveTextContent('5')
  await user.click(checkbox('testuser_卵'))
  expect(checkbox('testuser_卵')).not.toBeChecked()
  expect(count('testuser_卵')).toHaveTextContent('3')
  expect(screen.getByText('購入済み 0件')).toBeInTheDocument()
})

it('詳細で入れた小数の実購入数を行に表示し、そこから1ずつ増減する', async () => {
  const user = userEvent.setup()
  render(<ShoppingListPanel {...props()} />)
  await user.click(checkbox('testuser_牛乳'))
  await user.click(screen.getByRole('button', { name: 'testuser_牛乳の詳細' }))
  const actual = screen.getByRole('textbox', { name: 'testuser_牛乳の実購入数' })
  await user.clear(actual)
  await user.type(actual, '2.5')
  await user.click(screen.getByRole('button', { name: '閉じる' }))
  expect(count('testuser_牛乳')).toHaveTextContent('2.5')
  await user.click(plus('testuser_牛乳'))
  expect(count('testuser_牛乳')).toHaveTextContent('3.5')
  await user.click(minus('testuser_牛乳'))
  await user.click(minus('testuser_牛乳'))
  await user.click(minus('testuser_牛乳'))
  expect(count('testuser_牛乳')).toHaveTextContent('0.5')
  await user.click(minus('testuser_牛乳'))
  expect(count('testuser_牛乳')).toHaveTextContent('0')
  // 行で変えた数は、詳細の実購入数にも同じ値で出る。
  await user.click(plus('testuser_牛乳'))
  await user.click(screen.getByRole('button', { name: 'testuser_牛乳の詳細' }))
  expect(screen.getByRole('textbox', { name: 'testuser_牛乳の実購入数' })).toHaveValue('1')
})

it('詳細で実購入数を空にした行は「未入力」と表示し、＋で1から入れ直せる', async () => {
  const user = userEvent.setup()
  render(<ShoppingListPanel {...props()} />)
  await user.click(checkbox('testuser_卵'))
  await user.click(screen.getByRole('button', { name: 'testuser_卵の詳細' }))
  await user.clear(screen.getByRole('textbox', { name: 'testuser_卵の実購入数' }))
  await user.click(screen.getByRole('button', { name: '閉じる' }))
  expect(count('testuser_卵')).toHaveTextContent('未入力')
  expect(screen.getByRole('button', { name: '購入を反映' })).toBeDisabled()
  await user.click(plus('testuser_卵'))
  expect(count('testuser_卵')).toHaveTextContent('1')
  expect(screen.getByRole('button', { name: '購入を反映' })).toBeEnabled()
})

it('上限の99999.9では＋を無効にする', async () => {
  const user = userEvent.setup()
  render(<ShoppingListPanel {...props()} shopping={[{ ...shopping[0], plannedQuantity: 99999.9 }]} />)
  expect(plus('testuser_牛乳')).toBeDisabled()
  await user.click(minus('testuser_牛乳'))
  expect(count('testuser_牛乳')).toHaveTextContent('99998.9')
  expect(plus('testuser_牛乳')).toBeEnabled()
  await user.click(plus('testuser_牛乳'))
  expect(count('testuser_牛乳')).toHaveTextContent('99999.9')
  expect(plus('testuser_牛乳')).toBeDisabled()
})

it('購入の送信中は、チェックと同じく－／＋も無効にする', async () => {
  const user = userEvent.setup()
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  server.use(http.post('/api/shopping-list-items/purchases', async ({ request }) => {
    const body = await request.json() as { requestId: string }
    await blocked
    return HttpResponse.json({ requestId: body.requestId, updatedInventoryItems: [{ id: 1, quantity: 1.5 }], removedShoppingListItemIds: [11], remainingShoppingListItems: [] })
  }))
  render(<ShoppingListPanel {...props()} />)
  await user.click(plus('testuser_牛乳'))
  await user.click(screen.getByRole('button', { name: '購入を反映' }))
  await user.click(screen.getByRole('button', { name: 'この内容で購入を反映' }))
  await waitFor(() => expect(checkbox('testuser_卵')).toBeDisabled())
  expect(plus('testuser_卵')).toBeDisabled()
  expect(minus('testuser_卵')).toBeDisabled()
  release()
  await waitFor(() => expect(plus('testuser_卵')).toBeEnabled())
  expect(count('testuser_卵')).toHaveTextContent('3')
})

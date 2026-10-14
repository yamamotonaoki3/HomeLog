import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { describe, it, expect } from 'vitest'
import { server } from '../mocks/server'
import { ZaikoPage } from '../../pages/ZaikoPage'

function setup(path = '/zaiko') {
  const inventory = [{ id: 1, name: 'testuser_牛乳', categoryId: 1, storeId: null, quantity: 0, threshold: 1, price: 1280 as number | null }, { id: 2, name: 'testuser_卵', categoryId: 1, storeId: null, quantity: 2, threshold: 1, price: null as number | null }]
  const bodies: Record<string, unknown>[] = []
  server.use(
    http.get('/api/zaiko-categories', () => HttpResponse.json([{ id: 1, name: '食品', isDefault: true }])),
    http.get('/api/stores', () => HttpResponse.json([])),
    http.get('/api/inventory-items', () => HttpResponse.json(inventory)),
    http.get('/api/shopping-list-items', () => HttpResponse.json([{ id: 10, inventoryItemId: 1, name: inventory[0].name, price: inventory[0].price, isManual: false, purchased: false, purchasedQuantity: 0 }])),
    http.patch('/api/inventory-items/:id', async ({ request }) => {
      const body = await request.json() as Record<string, unknown>; bodies.push(body)
      inventory[0].price = body.price as number | null
      return HttpResponse.json(inventory[0])
    }),
    http.post('/api/inventory-items', async ({ request }) => { bodies.push(await request.json() as Record<string, unknown>); return HttpResponse.json(inventory[0], { status: 201 }) }),
    http.post('/api/shopping-list-items', async ({ request }) => { bodies.push(await request.json() as Record<string, unknown>); return HttpResponse.json({}, { status: 201 }) }),
  )
  render(<MemoryRouter initialEntries={[path]}><ZaikoPage /></MemoryRouter>)
  return { bodies, inventory }
}

describe('値段入力', () => {
  it('編集初期値を表示しPATCHで0と空欄nullを保存、数量を送らない', async () => {
    const { bodies } = setup(); const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'testuser_牛乳を編集' }))
    expect(screen.getByLabelText('値段（円・任意）')).toHaveValue('1280')
    await user.clear(screen.getByLabelText('値段（円・任意）'))
    await user.type(screen.getByLabelText('値段（円・任意）'), '0')
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(bodies[0]).toMatchObject({ price: 0 }))
    expect(bodies[0]).not.toHaveProperty('quantity')
    await waitFor(() => expect(within(screen.getByTestId('inventory-panel')).getByText('0円')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'testuser_牛乳を編集' }))
    await user.clear(screen.getByLabelText('値段（円・任意）'))
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(bodies[1]).toMatchObject({ price: null }))
  })
  it.each(['-1', '1.5', '10000000000', 'abc'])('不正な値段%sでは送信しない', async (price) => {
    const { bodies } = setup(); const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '在庫を登録' }))
    await user.type(screen.getByLabelText('品名'), 'testuser_品目')
    fireEvent.change(screen.getByLabelText('値段（円・任意）'), { target: { value: price } })
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByText('値段は0〜9,999,999,999円の整数で入力してください')).toBeInTheDocument()
    expect(bodies).toHaveLength(0)
  })
  it.each(['', '9999999999'])('任意値段%sで登録できる', async (price) => {
    const { bodies } = setup(); const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '在庫を登録' }))
    await user.type(screen.getByLabelText('品名'), 'testuser_品目')
    if (price) await user.type(screen.getByLabelText('値段（円・任意）'), price)
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(bodies[0]).toMatchObject({ price: price ? Number(price) : null }))
  })
  it('手動追加は選択品目の値段を切り替え、空欄なら省略する', async () => {
    const { bodies } = setup('/zaiko/shopping'); const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '品目を手動追加' }))
    await user.selectOptions(screen.getByLabelText('追加する品目'), '1')
    expect(screen.getByLabelText('値段（円・任意）')).toHaveValue('1280')
    await user.selectOptions(screen.getByLabelText('追加する品目'), '2')
    expect(screen.getByLabelText('値段（円・任意）')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: /^追加$/ }))
    await waitFor(() => expect(bodies[0]).toEqual({ inventoryItemId: 2 }))
  })
  it('編集のキャンセルと保存失敗では表示を維持し、再試行で両一覧を更新する', async () => {
    const { bodies } = setup(); const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'testuser_牛乳を編集' }))
    await user.clear(screen.getByLabelText('値段（円・任意）'))
    await user.type(screen.getByLabelText('値段（円・任意）'), '980')
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(bodies).toHaveLength(0)
    expect(within(screen.getByTestId('inventory-panel')).getByText('1,280円')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'testuser_牛乳を編集' }))
    await user.clear(screen.getByLabelText('値段（円・任意）'))
    await user.type(screen.getByLabelText('値段（円・任意）'), '980')
    server.use(http.patch('/api/inventory-items/:id', () => HttpResponse.json({ message: '保存失敗' }, { status: 500 }), { once: true }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('保存失敗')
    expect(within(screen.getByTestId('inventory-panel')).getByText('1,280円')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(within(screen.getByTestId('inventory-panel')).getByText('980円')).toBeInTheDocument())
    expect(within(screen.getByTestId('shopping-panel')).getByText('980円')).toBeInTheDocument()
    expect(screen.queryByText('1,280円')).not.toBeInTheDocument()
  })
  it('手動追加の値段0を送信し、不正な値段ではAPIを呼ばない', async () => {
    const { bodies } = setup('/zaiko/shopping'); const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '品目を手動追加' }))
    await user.selectOptions(screen.getByLabelText('追加する品目'), '2')
    await user.type(screen.getByLabelText('値段（円・任意）'), '-1')
    await user.click(screen.getByRole('button', { name: /^追加$/ }))
    expect(bodies).toHaveLength(0)
    expect(screen.getByText('値段は0〜9,999,999,999円の整数で入力してください')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('値段（円・任意）'))
    await user.type(screen.getByLabelText('値段（円・任意）'), '0')
    await user.click(screen.getByRole('button', { name: /^追加$/ }))
    await waitFor(() => expect(bodies[0]).toEqual({ inventoryItemId: 2, price: 0 }))
  })
  it('追加成功後の入力をリセットして古い価格の再送信を防ぐ', async () => {
    const { bodies } = setup('/zaiko/shopping'); const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '品目を手動追加' }))
    await user.selectOptions(screen.getByLabelText('追加する品目'), '1')
    await user.click(screen.getByRole('button', { name: /^追加$/ }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    await waitFor(() => expect(screen.queryByLabelText('追加する品目')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: '品目を手動追加' }))
    expect(screen.getByLabelText('追加する品目')).toHaveValue('')
    expect(screen.getByLabelText('値段（円・任意）')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: /^追加$/ }))
    expect(bodies).toHaveLength(1)
  })
})

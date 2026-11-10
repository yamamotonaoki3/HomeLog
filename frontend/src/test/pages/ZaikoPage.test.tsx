import { shoppingEnvironment } from '../shoppingEnvironment'
shoppingEnvironment()
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { server } from '../mocks/server'
import { ZaikoPage } from '../../pages/ZaikoPage'
import { apiClient } from '../../api/client'
import { clearTokens } from '../../api/tokenStorage'
import type { InventoryItem, ShoppingListItem } from '../../api/zaikoTypes'

const defaultCategories = [
  { id: 1, name: '野菜', isDefault: true },
  { id: 2, name: '乳製品', isDefault: true },
]
const defaultStores = [{ id: 1, name: 'スーパーA' }]

interface MockState {
  inventory: InventoryItem[]
  shopping: ShoppingListItem[]
}

/** 在庫・買い物リストAPI一式を状態ベースでモックし、リクエスト記録と状態を返す */
function setupApi(initial: Partial<MockState> = {}) {
  const state: MockState = {
    inventory: initial.inventory ?? [],
    shopping: initial.shopping ?? [],
  }
  const calls: { method: string; url: string; body?: unknown }[] = []

  server.use(
    http.get('/api/zaiko-categories', () => HttpResponse.json(defaultCategories)),
    http.get('/api/stores', () => HttpResponse.json(defaultStores)),
    http.post('/api/stores', async ({ request }) => {
      const body = (await request.json()) as { name: string }
      calls.push({ method: 'POST', url: '/api/stores', body })
      const store = { id: 99, name: body.name }
      defaultStores.push(store)
      return HttpResponse.json(store, { status: 201 })
    }),
    http.get('/api/inventory-items', () => HttpResponse.json(state.inventory)),
    http.post('/api/inventory-items', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'POST', url: '/api/inventory-items', body })
      const item: InventoryItem = {
        id: 100,
        name: body.name as string,
        categoryId: body.categoryId as number,
        storeId: (body.storeId as number | null) ?? null,
        quantity: body.quantity as number,
        threshold: body.threshold as number,
        dailyConsumption: body.dailyConsumption as number | null,
        autoConsumptionEnabled: body.autoConsumptionEnabled as boolean,
      }
      state.inventory.push(item)
      if (item.quantity <= item.threshold) {
        state.shopping.push({
          id: 200,
          inventoryItemId: item.id,
          name: item.name,
          isManual: false,
          purchased: false,
          purchasedQuantity: 0, plannedQuantity: 1, purchaseRevision: 0,
        })
      }
      return HttpResponse.json(item, { status: 201 })
    }),
    http.patch('/api/inventory-items/:id/quantity', async ({ request, params }) => {
      const body = (await request.json()) as { delta: number }
      calls.push({ method: 'PATCH', url: `/api/inventory-items/${params.id}/quantity`, body })
      const item = state.inventory.find((i) => i.id === Number(params.id))!
      item.quantity = Math.round((item.quantity + body.delta) * 10) / 10
      if (item.quantity <= item.threshold && !state.shopping.some((s) => s.inventoryItemId === item.id)) {
        state.shopping.push({
          id: 201,
          inventoryItemId: item.id,
          name: item.name,
          isManual: false,
          purchased: false,
          purchasedQuantity: 0, plannedQuantity: 1, purchaseRevision: 0,
        })
      }
      return HttpResponse.json({ id: item.id, quantity: item.quantity })
    }),
    http.get('/api/shopping-list-items', ({ request }) => {
      calls.push({ method: 'GET', url: new URL(request.url).pathname + new URL(request.url).search })
      return HttpResponse.json(state.shopping)
    }),
    http.post('/api/shopping-list-items', async ({ request }) => {
      const body = (await request.json()) as { inventoryItemId: number }
      calls.push({ method: 'POST', url: '/api/shopping-list-items', body })
      const inv = state.inventory.find((i) => i.id === body.inventoryItemId)!
      const item: ShoppingListItem = {
        id: 300,
        inventoryItemId: inv.id,
        name: inv.name,
        isManual: true,
        purchased: false,
        purchasedQuantity: 0, plannedQuantity: 1, purchaseRevision: 0,
      }
      state.shopping.push(item)
      return HttpResponse.json(item, { status: 201 })
    }),
    http.delete('/api/shopping-list-items/:id', ({ params }) => {
      calls.push({ method: 'DELETE', url: `/api/shopping-list-items/${params.id}` })
      state.shopping = state.shopping.filter((s) => s.id !== Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
    http.post('/api/shopping-list-items/purchases', async ({ request }) => {
      const body = (await request.json()) as { requestId: string; items: { id: number; purchasedQuantity: number; expectedPurchaseRevision: number }[] }
      calls.push({ method: 'POST', url: '/api/shopping-list-items/purchases', body })
      const removed: number[] = []
      const updated: { id: number; quantity: number }[] = []
      for (const line of body.items) {
        const entry = state.shopping.find((s) => s.id === line.id)
        if (!entry) continue
        const inv = state.inventory.find((i) => i.id === entry.inventoryItemId)!
        inv.quantity = Math.round((inv.quantity + line.purchasedQuantity) * 10) / 10
        updated.push({ id: inv.id, quantity: inv.quantity })
        if (inv.quantity >= inv.threshold || entry.isManual) {
          state.shopping = state.shopping.filter((s) => s.id !== line.id)
          removed.push(line.id)
        }
      }
      return HttpResponse.json({ requestId: body.requestId, updatedInventoryItems: updated, removedShoppingListItemIds: removed, remainingShoppingListItems: [] })
    }),
  )

  return { state, calls }
}

// 本番ではタブはAppLayoutの上部タブにあるため、テストでは同じリンク先を持つ簡易タブを置く
function renderZaikoPage(initialPath = '/zaiko') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Link to="/zaiko">在庫一覧</Link>
      <Link to="/zaiko/shopping">買い物リスト</Link>
      <Routes>
        <Route path="/zaiko" element={<ZaikoPage />}>
          <Route path="shopping" element={null} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

async function openTab(user: ReturnType<typeof userEvent.setup>, name: '在庫一覧' | '買い物リスト') {
  await user.click(screen.getByRole('link', { name }))
}

const milk: InventoryItem = { id: 1, name: '牛乳', categoryId: 2, storeId: 1, quantity: 2.0, threshold: 0.5, dailyConsumption: null, autoConsumptionEnabled: false }
const egg: InventoryItem = { id: 2, name: '卵', categoryId: 1, storeId: null, quantity: 0.0, threshold: 1.0, dailyConsumption: null, autoConsumptionEnabled: false }

async function openInventoryDetails(user: ReturnType<typeof userEvent.setup>, name: string) {
  const row = await screen.findByRole('button', { name: name + 'の詳細' })
  if (row.getAttribute('aria-expanded') !== 'true') await user.click(row)
  await user.click(screen.getByRole('button', { name: name + 'の詳細を編集' }))
}

describe('ZaikoPage', () => {
  it('購入の初回未検証では在庫の登録モーダルとカテゴリー入力を維持する', async () => {
    clearTokens()
    setupApi()
    const user = userEvent.setup()
    renderZaikoPage()
    await screen.findByRole('button', { name: '本人と世帯を再確認', hidden: true })
    expect(screen.getByTestId('inventory-panel')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '在庫を登録' }))
    await user.type(screen.getByLabelText('品名'), 'testuser_初回未検証品目')
    await user.click(screen.getByRole('button', { name: '＋カテゴリーを登録' }))
    await user.type(screen.getByLabelText('カテゴリー名'), 'testuser_初回カテゴリー')
    expect(screen.getByLabelText('品名')).toHaveValue('testuser_初回未検証品目')
    expect(screen.getByLabelText('カテゴリー名')).toHaveValue('testuser_初回カテゴリー')
    expect(screen.getByRole('dialog', { name: '在庫を登録' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '購入を反映', hidden: true })).not.toBeInTheDocument()
  })

  it.each([false, true])('世帯再接続は両一覧の成功まで隔離し、後着した旧世帯GETを破棄する: 初回GET失敗=%s', async (failFirst) => {
    const oldInventory = { ...egg, name: 'testuser_旧世帯品目' }
    const oldShopping: ShoppingListItem = { id: 10, inventoryItemId: 2, name: oldInventory.name, isManual: true, purchased: false, purchasedQuantity: 0, plannedQuantity: 1, purchaseRevision: 0 }
    setupApi({ inventory: [oldInventory], shopping: [oldShopping] })
    const user = userEvent.setup()
    renderZaikoPage()
    await openInventoryDetails(user, oldInventory.name)
    const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
    const gates = [deferred(), deferred(), deferred()]
    const arrived = [deferred(), deferred(), deferred()]
    const counts = [0, 0, 0]
    let inventoryGets = 0, shoppingGets = 0
    const freshInventory = { ...oldInventory, id: 31, name: 'testuser_新世帯品目', quantity: 7.5 }
    const freshShopping = { ...oldShopping, id: 41, inventoryItemId: 31, name: freshInventory.name, plannedQuantity: 6 }
    const get = vi.spyOn(apiClient, 'get')
    const waitForReply = async (index: number) => { if (++counts[index] === 2) arrived[index].resolve(); await gates[index].promise }
    server.use(
      http.get('/api/inventory-items', async () => {
        const index = inventoryGets++; await waitForReply(index)
        if (index === 1 && failFirst) return HttpResponse.json({}, { status: 503 })
        return HttpResponse.json([index === 0 ? oldInventory : freshInventory])
      }),
      http.get('/api/shopping-list-items', async () => {
        const index = shoppingGets++; await waitForReply(index)
        return HttpResponse.json([index === 0 ? oldShopping : freshShopping])
      }),
    )
    try {
      // An inventory mutation starts both old-scope GETs, independently of the shopping panel.
      await user.click(screen.getByRole('button', { name: oldInventory.name + 'を増やす' }))
      await act(async () => { await arrived[0].promise })
      const oldGets = get.mock.results.filter(result => result.type === 'return').map(result => result.value as Promise<unknown>)
      await openTab(user, '買い物リスト')
      const check = screen.getByRole('checkbox', { name: oldInventory.name + 'を購入済みにする' })
      await waitFor(() => expect(check).toBeEnabled()); await user.click(check)
      server.use(http.get('/api/households/me', () => HttpResponse.json({ id: 20 })))
      await user.click(screen.getByRole('button', { name: '購入を反映' }))
      await user.click(screen.getByRole('button', { name: 'この内容で購入を反映' }))
      await screen.findByRole('button', { name: '本人と世帯を再確認' })
      const expectIsolated = () => {
        expect(screen.queryByTestId('inventory-panel')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: oldInventory.name + 'の詳細', hidden: true })).not.toBeInTheDocument()
        expect(screen.queryByRole('checkbox', { name: oldInventory.name + 'を購入済みにする', hidden: true })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: freshInventory.name + 'の詳細', hidden: true })).not.toBeInTheDocument()
      }
      expectIsolated()
      await user.click(screen.getByRole('button', { name: '本人と世帯を再確認' }))
      await act(async () => { await arrived[1].promise })
      expectIsolated(); expect(screen.getByRole('button', { name: '品目を追加' })).toBeDisabled()
      await act(async () => { gates[1].resolve() })
      if (failFirst) {
        const retry = await screen.findByRole('button', { name: '一覧を再取得' })
        expectIsolated()
        await user.click(retry)
        await act(async () => { await arrived[2].promise })
        expectIsolated()
        await act(async () => { gates[2].resolve() })
      }
      const freshCheck = await screen.findByRole('checkbox', { name: freshInventory.name + 'を購入済みにする' })
      await waitFor(() => expect(freshCheck).toBeEnabled())
      expect(freshCheck).not.toBeChecked()
      // Wait for the actual old client requests, so assertions run after their state handlers.
      await act(async () => { gates[0].resolve(); await Promise.allSettled(oldGets) })
      expect(screen.queryByRole('button', { name: oldInventory.name + 'の詳細', hidden: true })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: freshInventory.name + 'の詳細' })).toHaveTextContent('在庫 7.5')
      await openTab(user, '在庫一覧')
      await openInventoryDetails(user, freshInventory.name)
      expect(within(screen.getByRole('dialog', { name: '在庫の詳細編集' })).getByText('7.5')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: oldInventory.name + 'の詳細', hidden: true })).not.toBeInTheDocument()
    } finally { gates.forEach(gate => gate.resolve()); get.mockRestore() }
  })

  it.each(['登録', '編集'] as const)('在庫の%sで409ならモーダル内にサーバーのエラーを表示し入力を保持する', async (mode) => {
    setupApi({ inventory: [{ ...milk }, { ...egg }] })
    const conflict = () => HttpResponse.json({
      code: 'DUPLICATE_INVENTORY_ITEM_NAME',
      message: '同じ品名の在庫が既に登録されています',
    }, { status: 409 })
    server.use(
      http.post('/api/inventory-items', conflict),
      http.patch('/api/inventory-items/:id', conflict),
    )
    const user = userEvent.setup()
    renderZaikoPage()
    await screen.findByRole('button', { name: '牛乳の詳細' })
    if (mode === '編集') {
      await openInventoryDetails(user, '卵')
    } else {
      await user.click(screen.getByRole('button', { name: '在庫を登録' }))
    }
    const modal = screen.getByRole('dialog', { name: mode === '編集' ? '在庫の詳細編集' : '在庫を登録' })
    await user.clear(within(modal).getByLabelText('品名'))
    await user.type(within(modal).getByLabelText('品名'), '牛乳')
    await user.type(within(modal).getByLabelText('値段（円・任意）'), '123')
    await user.click(within(modal).getByRole('button', { name: '保存' }))
    expect(await within(modal).findByRole('alert')).toHaveTextContent('同じ品名の在庫が既に登録されています')
    expect(modal).toBeVisible()
    expect(within(modal).getByLabelText('品名')).toHaveValue('牛乳')
    expect(within(modal).getByLabelText('値段（円・任意）')).toHaveValue('123')
    expect(within(modal).getByRole('button', { name: '保存' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '卵の詳細' })).toBeInTheDocument()
    expect(screen.queryByText(`在庫を${mode}しました`)).not.toBeInTheDocument()
  })

  it('在庫操作は個数、＋、−の順で、品目ごとの増減幅を保持する', async () => {
    const { calls } = setupApi({ inventory: [{ ...milk }, { ...egg, quantity: 2 }] })
    const user = userEvent.setup()
    renderZaikoPage()
    await openInventoryDetails(user, '牛乳')
    const plus = screen.getByRole('button', { name: '牛乳を増やす' })
    const row = screen.getByRole('dialog', { name: '在庫の詳細編集' })
    const controls = [...row.querySelectorAll('.inventory-quantity-controls button, .qty-value')]
    expect(controls).toEqual([
      row.querySelector('.qty-value'), plus,
      within(row).getByRole('button', { name: '牛乳を減らす' }),
    ])
    await user.click(within(screen.getByRole('group', { name: '増減幅' })).getByRole('button', { name: '0.1' }))
    await user.click(plus)
    await waitFor(() => expect(row.querySelector('.qty-value')).toHaveTextContent(/^2\.1$/))
    await user.click(screen.getByRole('button', { name: screen.queryByRole('dialog', { name: '在庫の詳細編集' }) ? 'キャンセル' : '閉じる' }))
    await openInventoryDetails(user, '卵')
    await user.click(screen.getByRole('button', { name: '卵を減らす' }))
    const eggRow = screen.getByRole('dialog', { name: '在庫の詳細編集' })
    await waitFor(() => expect(eggRow.querySelector('.qty-value')).toHaveTextContent(/^1\.0$/))
    expect(within(screen.getByRole('group', { name: '増減幅' })).getByRole('button', { name: '1' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: screen.queryByRole('dialog', { name: '在庫の詳細編集' }) ? 'キャンセル' : '閉じる' }))
    await openInventoryDetails(user, '牛乳')
    expect(within(screen.getByRole('group', { name: '増減幅' })).getByRole('button', { name: '0.1' })).toHaveAttribute('aria-pressed', 'true')
    expect(calls.filter((call) => call.method === 'PATCH')).toEqual([
      { method: 'PATCH', url: '/api/inventory-items/1/quantity', body: { delta: 0.1 } },
      { method: 'PATCH', url: '/api/inventory-items/2/quantity', body: { delta: -1 } },
    ])
  })

  it('/zaikoでは在庫一覧だけを表示し、買い物リストタブに切り替えると買い物リストだけを表示する', async () => {
    setupApi({
      inventory: [milk, egg],
      shopping: [{ id: 10, inventoryItemId: 2, name: '卵', isManual: false, purchased: false, purchasedQuantity: 0, plannedQuantity: 1, purchaseRevision: 0 }],
    })
    const user = userEvent.setup()
    renderZaikoPage()

    await waitFor(() => expect(screen.getByText('牛乳')).toBeInTheDocument())
    const inventoryPanel = screen.getByTestId('inventory-panel')
    // カテゴリーは絞り込みの選択肢に加えて、品名の下にも表示する(#469)。
    expect(within(within(inventoryPanel).getByRole('button', { name: '牛乳の詳細' })).getByText('乳製品')).toBeInTheDocument()
    await openInventoryDetails(user, '牛乳')
    expect(within(screen.getByRole('dialog')).getByText('乳製品')).toBeInTheDocument()
    expect(screen.getByText('スーパーA')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: screen.queryByRole('dialog', { name: '在庫の詳細編集' }) ? 'キャンセル' : '閉じる' }))
    expect(screen.getByTestId('shopping-panel')).not.toBeVisible()

    await openTab(user, '買い物リスト')

    const shoppingPanel = screen.getByTestId('shopping-panel')
    expect(within(shoppingPanel).getByText('卵')).toBeInTheDocument()
    expect(screen.getByTestId('inventory-panel')).not.toBeVisible()
  })

  it('/zaiko/shoppingを直接開くと買い物リストだけを表示する', async () => {
    setupApi({
      inventory: [egg],
      shopping: [{ id: 10, inventoryItemId: 2, name: '卵', isManual: false, purchased: false, purchasedQuantity: 0, plannedQuantity: 1, purchaseRevision: 0 }],
    })
    renderZaikoPage('/zaiko/shopping')

    const shoppingPanel = await screen.findByTestId('shopping-panel')
    expect(within(shoppingPanel).getByText('卵')).toBeInTheDocument()
    expect(screen.getByTestId('inventory-panel')).not.toBeVisible()
  })

  it('入力途中の購入個数はタブを行き来しても保持される', async () => {
    setupApi({
      inventory: [egg],
      shopping: [{ id: 10, inventoryItemId: 2, name: '卵', isManual: false, purchased: false, purchasedQuantity: 0, plannedQuantity: 1, purchaseRevision: 0 }],
    })
    const user = userEvent.setup()
    renderZaikoPage('/zaiko/shopping')
    const shoppingPanel = await screen.findByTestId('shopping-panel')
    await waitFor(() => expect(within(shoppingPanel).getByText('卵')).toBeInTheDocument())

    const checkbox = screen.getByRole('checkbox', { name: '卵を購入済みにする' })
    await waitFor(() => expect(checkbox).toBeEnabled())
    await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: '卵の詳細' }))
    await user.clear(screen.getByRole('textbox', { name: '卵の実購入数' }))
    await user.type(screen.getByRole('textbox', { name: '卵の実購入数' }), '2')
    await openTab(user, '在庫一覧')
    await openTab(user, '買い物リスト')

    const eggRow = screen.getByRole('dialog', { name: '買い物詳細' })
    expect(within(eggRow).getByRole('textbox', { name: '卵の実購入数' })).toHaveValue('2')
  })

  it('在庫一覧と買い物リストをキーワードで絞り込める (#315)', async () => {
    const butter: InventoryItem = { id: 3, name: 'Ｂｕｔｔｅｒ', categoryId: 2, storeId: null, quantity: 0, threshold: 1, dailyConsumption: null, autoConsumptionEnabled: false }
    setupApi({
      inventory: [milk, egg, butter],
      shopping: [
        { id: 10, inventoryItemId: 2, name: '卵', isManual: false, purchased: false, purchasedQuantity: 0, plannedQuantity: 1, purchaseRevision: 0 },
        { id: 11, inventoryItemId: 3, name: 'Ｂｕｔｔｅｒ', isManual: false, purchased: false, purchasedQuantity: 0, plannedQuantity: 1, purchaseRevision: 0 },
      ],
    })
    const user = userEvent.setup()
    renderZaikoPage()
    const inventoryPanel = await screen.findByTestId('inventory-panel')
    await within(inventoryPanel).findByRole('button', { name: '牛乳の詳細' })

    // 全角・半角、大文字・小文字を区別しない
    await user.type(within(inventoryPanel).getByRole('searchbox', { name: '商品を探す' }), 'butter')
    expect(within(inventoryPanel).getByRole('button', { name: 'Ｂｕｔｔｅｒの詳細' })).toBeInTheDocument()
    expect(within(inventoryPanel).queryByRole('button', { name: '牛乳の詳細' })).not.toBeInTheDocument()
    await user.clear(within(inventoryPanel).getByRole('searchbox', { name: '商品を探す' }))
    await user.type(within(inventoryPanel).getByRole('searchbox', { name: '商品を探す' }), 'チーズ')
    expect(within(inventoryPanel).getByText('該当する品目がありません')).toBeInTheDocument()

    await openTab(user, '買い物リスト')
    const shoppingPanel = screen.getByTestId('shopping-panel')
    await user.type(within(shoppingPanel).getByRole('searchbox', { name: '商品を探す' }), '卵')
    expect(within(shoppingPanel).getByRole('button', { name: '卵の詳細' })).toBeInTheDocument()
    expect(within(shoppingPanel).queryByRole('button', { name: 'Ｂｕｔｔｅｒの詳細' })).not.toBeInTheDocument()
    await user.clear(within(shoppingPanel).getByRole('searchbox', { name: '商品を探す' }))
    expect(within(shoppingPanel).getByRole('button', { name: 'Ｂｕｔｔｅｒの詳細' })).toBeInTheDocument()
  })

  it('在庫・買い物リストが空のときプレースホルダーを表示する', async () => {
    setupApi()
    const user = userEvent.setup()
    renderZaikoPage()

    await waitFor(() => expect(screen.getByText('在庫がありません')).toBeInTheDocument())
    await openTab(user, '買い物リスト')
    expect(screen.getByText('買い物リストは空です')).toBeInTheDocument()
  })

  it('＋ボタンでステップ1のPATCHが飛び表示が更新される', async () => {
    const { calls } = setupApi({ inventory: [{ ...milk }] })
    const user = userEvent.setup()
    renderZaikoPage()
    await openInventoryDetails(user, '牛乳')

    await user.click(screen.getByRole('button', { name: '牛乳を増やす' }))

    await waitFor(() => expect(screen.getByRole('dialog').querySelector('.qty-value')).toHaveTextContent(/^3\.0$/))
    const patchCall = calls.find((c) => c.method === 'PATCH')
    expect(patchCall?.body).toEqual({ delta: 1 })
  })

  it('ステップ0.1に切り替えて－ボタンを押すとdelta=-0.1が送られる', async () => {
    const { calls } = setupApi({ inventory: [{ ...milk }] })
    const user = userEvent.setup()
    renderZaikoPage()
    await openInventoryDetails(user, '牛乳')

    await user.click(within(screen.getByRole('group', { name: '増減幅' })).getByRole('button', { name: '0.1' }))
    await user.click(screen.getByRole('button', { name: '牛乳を減らす' }))

    await waitFor(() => expect(within(screen.getByRole('dialog')).getByText('1.9')).toBeInTheDocument())
    const patchCall = calls.find((c) => c.method === 'PATCH')
    expect(patchCall?.body).toEqual({ delta: -0.1 })
  })

  it('在庫減で閾値を下回ると買い物リストに自動追加が反映される', async () => {
    setupApi({ inventory: [{ id: 1, name: '牛乳', categoryId: 2, storeId: 1, quantity: 1.0, threshold: 0.5, dailyConsumption: null, autoConsumptionEnabled: false }] })
    const user = userEvent.setup()
    renderZaikoPage()
    await openInventoryDetails(user, '牛乳')

    await user.click(screen.getByRole('button', { name: '牛乳を減らす' }))
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByText('0.0')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: screen.queryByRole('dialog', { name: '在庫の詳細編集' }) ? 'キャンセル' : '閉じる' }))
    // タブを切り替えたときに、在庫の増減で自動追加された最新の買い物リストが表示される
    await openTab(user, '買い物リスト')
    const shoppingPanel = screen.getByTestId('shopping-panel')
    await waitFor(() => expect(within(shoppingPanel).getByText('牛乳')).toBeInTheDocument())
  })

  it('在庫登録モーダルで登録するとPOSTが飛び一覧に反映される', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderZaikoPage()
    await waitFor(() => expect(screen.getByText('在庫がありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '在庫を登録' }))
    await user.type(screen.getByLabelText('品名'), 'トマト')
    await user.selectOptions(screen.getByLabelText('カテゴリー'), '野菜')
    await user.clear(screen.getByLabelText('在庫個数'))
    await user.type(screen.getByLabelText('在庫個数'), '3')
    await user.clear(screen.getByLabelText(/買い物リスト追加閾値/))
    await user.type(screen.getByLabelText(/買い物リスト追加閾値/), '1')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(screen.getByText('トマト')).toBeInTheDocument())
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/inventory-items')
    expect(postCall?.body).toEqual({ name: 'トマト', categoryId: 1, storeId: null, quantity: 3, threshold: 1, dailyConsumption: null, autoConsumptionEnabled: false, price: null })
  })

  it('在庫登録モーダルで品名未入力はクライアント側エラーを表示しAPIを呼ばない', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderZaikoPage()
    await waitFor(() => expect(screen.getByText('在庫がありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '在庫を登録' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(screen.getByText('品名は1〜50文字で入力してください')).toBeInTheDocument())
    expect(calls.find((c) => c.url === '/api/inventory-items' && c.method === 'POST')).toBeUndefined()
  })

  it('在庫登録モーダルで在庫個数と閾値が空のときクライアント側エラーを表示しAPIを呼ばない', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderZaikoPage()
    await waitFor(() => expect(screen.getByText('在庫がありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '在庫を登録' }))
    await user.type(screen.getByLabelText('品名'), 'トマト')
    await user.clear(screen.getByLabelText('在庫個数'))
    await user.clear(screen.getByLabelText(/買い物リスト追加閾値/))
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(screen.getByText('在庫個数・閾値は0以上で入力してください')).toBeInTheDocument())
    expect(calls.find((c) => c.url === '/api/inventory-items' && c.method === 'POST')).toBeUndefined()
  })

  it('モーダル内の「＋店を登録」で店が追加され選択状態になる', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderZaikoPage()
    await waitFor(() => expect(screen.getByText('在庫がありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '在庫を登録' }))
    await user.click(screen.getByRole('button', { name: '＋店を登録' }))
    await user.type(screen.getByLabelText('店名'), 'スーパーC')
    await user.click(screen.getByRole('button', { name: '店を追加' }))

    await waitFor(() => {
      const storeSelect = screen.getByLabelText(/買う店/, { selector: 'select' }) as HTMLSelectElement
      expect(storeSelect.value).toBe('99')
    })
    expect(calls.find((c) => c.url === '/api/stores')?.body).toEqual({ name: 'スーパーC' })
  })

  it('品目を追加できる', async () => {
    const { calls } = setupApi({ inventory: [milk] })
    const user = userEvent.setup()
    renderZaikoPage('/zaiko/shopping')
    await screen.findByTestId('shopping-panel')

    await user.click(screen.getByRole('button', { name: '品目を追加' }))
    await user.selectOptions(screen.getByLabelText('追加する品目'), '牛乳')
    await user.click(screen.getByRole('button', { name: '追加' }))

    const shoppingPanel = screen.getByTestId('shopping-panel')
    await waitFor(() => expect(within(shoppingPanel).getByText('牛乳')).toBeInTheDocument())
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/shopping-list-items')?.body).toEqual({
      inventoryItemId: 1,
    })
  })

  it('削除ボタンでDELETEが飛びリストから消える', async () => {
    const { calls } = setupApi({
      inventory: [egg],
      shopping: [{ id: 10, inventoryItemId: 2, name: '卵', isManual: true, purchased: false, purchasedQuantity: 0, plannedQuantity: 1, purchaseRevision: 0 }],
    })
    const user = userEvent.setup()
    renderZaikoPage('/zaiko/shopping')
    const shoppingPanel = await screen.findByTestId('shopping-panel')
    await waitFor(() => expect(within(shoppingPanel).getByText('卵')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '卵の詳細' }))
    await user.click(screen.getByRole('button', { name: '卵を削除' }))

    await waitFor(() => expect(screen.getByText('買い物リストは空です')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/shopping-list-items/10')).toBe(true)
  })

  it('初期表示は買う店順（store）で取得される', async () => {
    const { calls } = setupApi({ inventory: [milk] })
    renderZaikoPage('/zaiko/shopping')
    await screen.findByTestId('shopping-panel')

    expect(calls.some((c) => c.method === 'GET' && c.url === '/api/shopping-list-items?sort=store')).toBe(true)
    expect(screen.getByLabelText('並び替え')).toHaveValue('store')
  })

  it('並び替えを変更するとsortパラメータ付きで再取得する', async () => {
    const { calls } = setupApi({ inventory: [milk] })
    const user = userEvent.setup()
    renderZaikoPage('/zaiko/shopping')
    await screen.findByTestId('shopping-panel')

    await user.selectOptions(screen.getByLabelText('並び替え'), 'カテゴリー順')

    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/shopping-list-items?sort=category')).toBe(true),
    )
  })

  it('在庫0のとき－を押すとトーストでエラーが表示されAPIは呼ばれない', async () => {
    const { calls } = setupApi({ inventory: [{ ...egg }] })
    const user = userEvent.setup()
    renderZaikoPage()
    await user.click(await screen.findByRole('button', { name: '卵の詳細' }))

    await user.click(screen.getByRole('button', { name: '卵を減らす' }))

    await waitFor(() => expect(screen.getByText('在庫個数は0未満にできません')).toBeInTheDocument())
    expect(calls.find((c) => c.method === 'PATCH')).toBeUndefined()
  })

  it('在庫登録が成功するとトーストで完了メッセージが表示される', async () => {
    setupApi()
    const user = userEvent.setup()
    renderZaikoPage()
    await waitFor(() => expect(screen.getByText('在庫がありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '在庫を登録' }))
    await user.type(screen.getByLabelText('品名'), 'トマト')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(screen.getByText('在庫を登録しました')).toBeInTheDocument())
  })

  it('購入個数を入れて更新すると個数を入力した分のみ一括反映される', async () => {
    const { calls } = setupApi({
      inventory: [{ ...egg }, { ...milk }],
      shopping: [
        { id: 10, inventoryItemId: 2, name: '卵', isManual: false, purchased: false, purchasedQuantity: 0, plannedQuantity: 1, purchaseRevision: 0 },
        { id: 11, inventoryItemId: 1, name: '牛乳', isManual: false, purchased: false, purchasedQuantity: 0, plannedQuantity: 1, purchaseRevision: 0 },
      ],
    })
    const user = userEvent.setup()
    renderZaikoPage('/zaiko/shopping')
    const shoppingPanel = await screen.findByTestId('shopping-panel')
    await waitFor(() => expect(within(shoppingPanel).getByText('卵')).toBeInTheDocument())

    expect(screen.getByRole('checkbox', { name: '卵を購入済みにする' })).toBeInTheDocument()

    const checkbox = screen.getByRole('checkbox', { name: '卵を購入済みにする' })
    await waitFor(() => expect(checkbox).toBeEnabled())
    await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: '卵の詳細' }))
    await user.clear(screen.getByRole('textbox', { name: '卵の実購入数' }))
    await user.type(screen.getByRole('textbox', { name: '卵の実購入数' }), '2')
    await user.click(screen.getByRole('button', { name: screen.queryByRole('dialog', { name: '在庫の詳細編集' }) ? 'キャンセル' : '閉じる' }))
    await user.click(screen.getByRole('button', { name: '購入を反映' }))
    await user.click(screen.getByRole('button', { name: 'この内容で購入を反映' }))

    // 卵のみ送信され（牛乳は個数未入力）、在庫2.0に更新・閾値1.0を上回るためリストから除外される
    await waitFor(() => {
      const updateCall = calls.find((c) => c.url === '/api/shopping-list-items/purchases')
      expect(updateCall?.body).toMatchObject({ requestId: expect.any(String), items: [{ id: 10, purchasedQuantity: 2, expectedPurchaseRevision: 0 }] })
    })
    await waitFor(() => expect(within(screen.getByTestId('shopping-panel')).queryByText('卵')).not.toBeInTheDocument())
    expect(screen.getByText('購入を反映しました')).toBeInTheDocument()

    // 在庫一覧タブに切り替えると、購入分が反映された最新の在庫が表示される
    await openTab(user, '在庫一覧')
    await openInventoryDetails(user, '卵')
    const eggRow = screen.getByRole('dialog', { name: '在庫の詳細編集' })
    expect(within(eggRow).getByText('2.0')).toBeInTheDocument()
  })
})

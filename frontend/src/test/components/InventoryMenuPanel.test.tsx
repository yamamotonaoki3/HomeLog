import { shoppingEnvironment } from '../shoppingEnvironment'
shoppingEnvironment()
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { InventoryPanel } from '../../components/zaiko/InventoryPanel'
const base = { inventory: [], categories: [{ id: 1, name: '[E2E_TEST] food', isDefault: false }], stores: [], onCategoriesChange: vi.fn(), onStoresChange: vi.fn(), onNotify: vi.fn(), actorUserId: 1 }
it('登録結果不明は編集と新規送信を止め、同じ内容で確認してから一覧のみ更新する', async () => {
  const bodies: unknown[] = []
  let refreshes = 0
  server.use(http.get('/api/recipes', () => HttpResponse.json([])), http.post('/api/inventory-items', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    bodies.push(body)
    if (bodies.length === 1) return HttpResponse.error()
    return HttpResponse.json({ ...body, id: 11, linkedMenuEntries: [{ id: 22, recipeId: 33, recipeTitle: '[E2E_TEST] dish', weekStartDate: '2026-11-09', usageQuantity: 1 }] }, { status: 201 })
  }))
  const user = userEvent.setup()
  render(<InventoryPanel {...base} onRefresh={async () => { refreshes++ }} />)
  await user.click(screen.getByRole('button', { name: '在庫を登録' }))
  fireEvent.change(screen.getByLabelText('品名'), { target: { value: '[E2E_TEST] chicken' } })
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'レシピも登録する' })).toBeEnabled())
  await user.click(screen.getByRole('checkbox', { name: 'レシピも登録する' }))
  fireEvent.change(screen.getByLabelText('新しい料理名'), { target: { value: '[E2E_TEST] dish' } })
  await user.click(screen.getByRole('button', { name: '料理を追加' }))
  await user.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText('結果を確認できません。同じ内容で確認してください')).toBeInTheDocument()
  expect(screen.getByLabelText('品名')).toBeDisabled()
  expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  expect(refreshes).toBe(0)
  await user.click(screen.getByRole('button', { name: '同じ内容で確認' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toEqual(bodies[0])
  expect(refreshes).toBe(1)
})
it('連携登録成功後のGET失敗では新規登録を止め、GETだけを再試行する', async () => {
  let posts = 0, refreshes = 0
  server.use(http.get('/api/recipes', () => HttpResponse.json([])), http.post('/api/inventory-items', async ({ request }) => {
    posts++
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json({ ...body, id: 11, linkedMenuEntries: [{ id: 22, recipeId: 33, recipeTitle: '[E2E_TEST] dish', weekStartDate: '2026-11-09', usageQuantity: 1 }] }, { status: 201 })
  }))
  const user = userEvent.setup()
  render(<InventoryPanel {...base} onRefresh={async () => { refreshes++; if (refreshes === 1) throw new Error('[E2E_TEST] refresh failed') }} />)
  await user.click(screen.getByRole('button', { name: '在庫を登録' }))
  fireEvent.change(screen.getByLabelText('品名'), { target: { value: '[E2E_TEST] chicken' } })
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'レシピも登録する' })).toBeEnabled())
  await user.click(screen.getByRole('checkbox', { name: 'レシピも登録する' }))
  fireEvent.change(screen.getByLabelText('新しい料理名'), { target: { value: '[E2E_TEST] dish' } })
  await user.click(screen.getByRole('button', { name: '料理を追加' }))
  await user.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: '在庫を登録' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '一覧を再取得' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '在庫を登録' })).toBeEnabled())
  expect(posts).toBe(1)
  expect(refreshes).toBe(2)
})
it('設定保存前に世帯が変わったら旧下書きを隔離し、旧設定を送信しない', async () => {
  let household = 10, patches = 0
  const detached = vi.fn()
  server.use(http.get('/api/households/me', () => HttpResponse.json({ id: household })), http.patch('/api/inventory-menu-links/4', () => { patches++; return HttpResponse.json({}) }))
  const user = userEvent.setup()
  const inventory = [{ id: 1, name: '[E2E_TEST] chicken', categoryId: 1, storeId: null, quantity: 3, threshold: 0, dailyConsumption: null, autoConsumptionEnabled: false, menuLinks: [{ id: 4, recipeId: 9, recipeTitle: '[E2E_TEST] dish', usageQuantity: 2, enabled: true, carryEnabled: false, revision: 3 }] }]
  render(<InventoryPanel {...base} inventory={inventory} onRefresh={vi.fn().mockResolvedValue(undefined)} onScopeDetached={detached} />)
  await user.click(screen.getByRole('button', { name: '[E2E_TEST] chickenの詳細' }))
  await user.click(screen.getByRole('button', { name: '[E2E_TEST] chickenの詳細を編集' }))
  household = 99
  await user.click(screen.getByRole('button', { name: '[E2E_TEST] dishの連携設定を保存' }))
  await waitFor(() => expect(detached).toHaveBeenCalled())
  expect(patches).toBe(0)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

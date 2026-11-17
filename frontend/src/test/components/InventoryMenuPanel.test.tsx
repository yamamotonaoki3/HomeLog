import { makeInventoryPlanResult } from '../mocks/inventoryPlan'
import type { InventoryPlanCreateBody } from '../../api/zaikoTypes'
﻿import { shoppingEnvironment } from '../shoppingEnvironment'
shoppingEnvironment()
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { InventoryPanel } from '../../components/zaiko/InventoryPanel'
const base = { inventory: [], categories: [{ id: 1, name: '[E2E_TEST] food', isDefault: false }], stores: [], onCategoriesChange: vi.fn(), onStoresChange: vi.fn(), onNotify: vi.fn(), actorUserId: 1 }
it('競合後は明示的な再取得と再編集で新しいrevisionを送る', async () => {
  const bodies: { expectedMenuPlanRevision: number }[] = []
  const item = { id: 1, name: '[E2E_TEST] chicken', categoryId: 1, storeId: null, quantity: 3, threshold: 0, dailyConsumption: null, autoConsumptionEnabled: false, menuPlanEnabled: false, menuPlanRevision: 4, menuLinks: [] }
  server.use(http.put('/api/inventory-items/1', async ({ request }) => {
    bodies.push(await request.json() as { expectedMenuPlanRevision: number })
    return HttpResponse.json({ code: 'RESOURCE_CONFLICT', message: '競合しました' }, { status: 409 })
  }))
  const user = userEvent.setup()
  let view: ReturnType<typeof render>
  const refresh: () => Promise<void> = vi.fn(async () => { view.rerender(<InventoryPanel {...base} inventory={[{ ...item, menuPlanRevision: 5 }]} onRefresh={refresh} />) })
  view = render(<InventoryPanel {...base} inventory={[item]} onRefresh={refresh} />)
  await user.click(screen.getByRole('button', { name: '[E2E_TEST] chickenの詳細' }))
  await user.click(screen.getByRole('button', { name: '[E2E_TEST] chickenの詳細を編集' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText('下書きを閉じて一覧を再取得し、編集し直してください。')).toBeVisible()
  expect(bodies).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: 'キャンセル' }))
  await user.click(screen.getByRole('button', { name: '一覧を再取得' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '一覧を再取得' })).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: '[E2E_TEST] chickenの詳細を編集' }))
  await user.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(bodies).toHaveLength(2))
  expect(bodies.map(body => body.expectedMenuPlanRevision)).toEqual([4, 5])
})
it('登録結果不明は編集と新規送信を止め、同じ内容で確認してから一覧のみ更新する', async () => {
  const bodies: unknown[] = []
  let refreshes = 0
  server.use(http.get('/api/recipes', () => HttpResponse.json([])), http.post('/api/inventory-items', async ({ request }) => {
    const body = await request.json() as InventoryPlanCreateBody
    bodies.push(body)
    if (bodies.length === 1) return HttpResponse.error()
    return HttpResponse.json(makeInventoryPlanResult(body), { status: 201 })
  }))
  const user = userEvent.setup()
  render(<InventoryPanel {...base} onRefresh={async () => { refreshes++ }} />)
  await user.click(screen.getByRole('button', { name: '在庫を登録' }))
  fireEvent.change(screen.getByLabelText('品名'), { target: { value: '[E2E_TEST] chicken' } })
  await waitFor(() => expect(screen.getByRole('checkbox', { name: '献立と連携する' })).toBeEnabled())
  await user.click(screen.getByRole('checkbox', { name: '献立と連携する' }))
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
    const body = await request.json() as InventoryPlanCreateBody
    return HttpResponse.json(makeInventoryPlanResult(body), { status: 201 })
  }))
  const user = userEvent.setup()
  render(<InventoryPanel {...base} onRefresh={async () => { refreshes++; if (refreshes === 1) throw new Error('[E2E_TEST] refresh failed') }} />)
  await user.click(screen.getByRole('button', { name: '在庫を登録' }))
  fireEvent.change(screen.getByLabelText('品名'), { target: { value: '[E2E_TEST] chicken' } })
  await waitFor(() => expect(screen.getByRole('checkbox', { name: '献立と連携する' })).toBeEnabled())
  await user.click(screen.getByRole('checkbox', { name: '献立と連携する' }))
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
  server.use(http.get('/api/households/me', () => HttpResponse.json({ id: household })), http.put('/api/inventory-items/1', () => { patches++; return HttpResponse.json({}) }))
  const user = userEvent.setup()
  const inventory = [{ id: 1, name: '[E2E_TEST] chicken', categoryId: 1, storeId: null, quantity: 3, threshold: 0, dailyConsumption: null, autoConsumptionEnabled: false, menuLinks: [{ id: 4, recipeId: 9, recipeTitle: '[E2E_TEST] dish', usageQuantity: 2, enabled: true, carryEnabled: false, revision: 3, remainingCount: 2, memo: null }] }]
  render(<InventoryPanel {...base} inventory={inventory} onRefresh={vi.fn().mockResolvedValue(undefined)} onScopeDetached={detached} />)
  await user.click(screen.getByRole('button', { name: '[E2E_TEST] chickenの詳細' }))
  await user.click(screen.getByRole('button', { name: '[E2E_TEST] chickenの詳細を編集' }))
  household = 99
  await user.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(detached).toHaveBeenCalled())
  expect(patches).toBe(0)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

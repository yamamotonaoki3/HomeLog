import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { DashboardPage } from '../../pages/DashboardPage'
import type { InventoryItem } from '../../api/zaikoTypes'

function setupApi(options: {
  summary?: { shoppingListCount: number; lowStockCount: number }
  inventory?: InventoryItem[]
  summaryError?: boolean
} = {}) {
  server.use(
    http.get('/api/dashboard/summary', () => {
      if (options.summaryError) {
        return HttpResponse.json({ code: 'INTERNAL_ERROR', message: 'サマリーの取得に失敗しました' }, { status: 500 })
      }
      return HttpResponse.json(options.summary ?? { shoppingListCount: 0, lowStockCount: 0 })
    }),
    http.get('/api/inventory-items', () => HttpResponse.json(options.inventory ?? [])),
  )
}

function renderDashboardPage() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <DashboardPage />
    </MemoryRouter>,
  )
}

const inventory: InventoryItem[] = [
  { id: 1, name: '卵', categoryId: 5, storeId: null, quantity: 2, threshold: 1 },
  { id: 2, name: '牛乳', categoryId: 4, storeId: null, quantity: 1, threshold: 0.5 },
  { id: 3, name: '醤油', categoryId: 6, storeId: null, quantity: 0.5, threshold: 1 },
  { id: 4, name: '味噌', categoryId: 6, storeId: null, quantity: 3, threshold: 1 },
]

describe('DashboardPage', () => {
  it('買い物リスト件数・在庫不足件数・よく使う品目（先頭3件）が表示される', async () => {
    setupApi({ summary: { shoppingListCount: 3, lowStockCount: 2 }, inventory })
    renderDashboardPage()

    await waitFor(() => expect(screen.getByText('買い物・在庫')).toBeInTheDocument())
    expect(screen.getByText(/買い物リスト: 3件/)).toBeInTheDocument()
    expect(screen.getByText(/在庫不足: 2件/)).toBeInTheDocument()
    expect(screen.getByText(/よく使う品目: 卵・牛乳・醤油/)).toBeInTheDocument()
  })

  it('在庫が0件のとき「よく使う品目: なし」を表示する', async () => {
    setupApi({ summary: { shoppingListCount: 0, lowStockCount: 0 }, inventory: [] })
    renderDashboardPage()

    await waitFor(() => expect(screen.getByText(/よく使う品目: なし/)).toBeInTheDocument())
  })

  it('「買い物リストを見る」リンクが/zaikoを指す', async () => {
    setupApi({ summary: { shoppingListCount: 1, lowStockCount: 1 }, inventory })
    renderDashboardPage()

    await waitFor(() =>
      expect(screen.getByRole('link', { name: '買い物リストを見る' })).toHaveAttribute('href', '/zaiko'),
    )
  })

  it('API失敗時はトーストでエラーを表示する', async () => {
    setupApi({ summaryError: true })
    renderDashboardPage()

    await waitFor(() => expect(screen.getByText('サマリーの取得に失敗しました')).toBeInTheDocument())
  })
})

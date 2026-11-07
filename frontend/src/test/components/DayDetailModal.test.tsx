import { AxiosHeaders, type AxiosResponse } from 'axios'
import { apiClient } from '../../api/client'
import { StrictMode, useState } from 'react'
import { act, render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
import { DayDetailModal } from '../../components/dashboard/DayDetailModal'
import type { DashboardDayDetail, FixedCostPostingStatus } from '../../api/dashboardTypes'
import type { CalendarDay } from '../../components/dashboard/CalendarPanel'
const date = '2026-11-07'
const calendarDay = (value = date): CalendarDay => ({ date: value, events: [], fixedCosts: [], income: 999, expense: 888, balance: 111 })
const recipe = { id: 1, title: '[E2E_TEST] 献立', ingredients: 'じゃがいも', steps: '煮る', sourceType: 'manual', url: null, thumbnailUrl: null, memo: null, isFavorite: false }
const event = { id: 2, name: '[E2E_TEST] 予定', isRecurring: true, recurrenceType: 'monthly' as const, eventDate: '2026-01-07' }
function detail(value = date): DashboardDayDetail {
  return { date: value, weekStartDate: '2026-11-02',
    menuEntries: [{ id: 1, recipeId: 1, recipeTitle: recipe.title, freeTextMemo: null, weekStartDate: '2026-11-02' }],
    events: [event],
    finance: { income: 1000, expense: 82000, balance: -81000,
      incomes: [{ id: 3, incomeDate: value, amount: 1000, content: '[E2E_TEST] 収入' }],
      expenses: [{ id: 4, expenseDate: value, amount: 80000, purpose: '[E2E_TEST] 家賃実績', fixedCostId: 6, fixedCostYearMonth: '2026-11' },
        { id: 5, expenseDate: value, amount: 2000, purpose: '[E2E_TEST] 食費', fixedCostId: null, fixedCostYearMonth: null }] },
    fixedCosts: [{ id: 6, name: '[E2E_TEST] 家賃予定', amount: 90000, paymentDate: value, yearMonth: '2026-11', postingStatus: 'posted',
      postedExpense: { id: 4, expenseDate: '2026-11-06', amount: 80000 } }],
  }
}
function setup(data = detail()) {
  server.use(
    http.get('/api/dashboard/day-detail', () => HttpResponse.json(data)),
    http.get('/api/events', () => HttpResponse.json([{ ...event, personal: false, editable: true, isAllDay: false, startTime: '09:00', endTime: '10:00', notifyEnabled: true, defaultAmount: 3000, showOnDashboard: true }])),
    http.get('/api/recipes', () => HttpResponse.json([recipe])),
  )
}
function renderDay(value = date, onClose = vi.fn()) {
  return render(<MemoryRouter><DayDetailModal day={calendarDay(value)} onClose={onClose} /></MemoryRouter>)
}
async function expand(name: string) {
  const button = await screen.findByRole('button', { name: new RegExp('^' + name + '.*件') })
  await userEvent.setup().click(button)
  return button
}
describe('#431 日次詳細', () => {
  it('新APIの4セクションは指定順に全閉で、独立に複数展開できる', async () => {
    setup()
    renderDay()
    const buttons = await screen.findAllByRole('button', { name: /^(今週の献立|イベント|収支|固定費).*件/ })
    expect(buttons.map(b => b.textContent)).toEqual(['今週の献立 1件', 'イベント 1件', '収支 3件', '固定費 1件'])
    for (const b of buttons) expect(b).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('収支: -81,000円')).not.toBeVisible()
    expect(screen.queryByRole('region', { name: '収支' })).not.toBeInTheDocument()
    await expand('今週の献立')
    await expand('収支')
    expect(buttons[0]).toHaveAttribute('aria-expanded', 'true')
    expect(buttons[2]).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'この週の献立を編集' })).toHaveAttribute('href', '/menu?week=2026-11-02')
    expect(screen.getByRole('link', { name: '支出を登録' })).toHaveAttribute('href', '/kakeibo')
  })
  it('実績82000と予定90000/計上記録80000を区別し予定を合計に再加算しない', async () => {
    setup(); renderDay()
    await expand('収支')
    expect(screen.getByText('支出: 82,000円')).toBeVisible()
    expect(screen.queryByText(/支出: 172,000/)).not.toBeInTheDocument()
    await expand('固定費')
    const fixed = screen.getByRole('region', { name: '固定費' })
    expect(fixed).toHaveTextContent('予定額: 90,000円')
    expect(fixed).toHaveTextContent('計上記録: 80,000円')
    expect(fixed).toHaveTextContent('支出に計上済み')
    expect(fixed).toHaveTextContent('銀行引き落とし')
  })
  it.each<[FixedCostPostingStatus, string]>([
    ['posted', '支出に計上済み'], ['scheduled', '計上予定'], ['missing', '計上記録なし'],
    ['suppressed', '再計上しない'], ['not_applicable', '計上対象外'], ['unknown', '確認できません'],
  ])('%sは%sを表示し、FEで計上状態を推測しない', async (status, label) => {
    const data = detail()
    data.fixedCosts[0] = { ...data.fixedCosts[0], postingStatus: status, postedExpense: null }
    setup(data); renderDay()
    await expand('固定費')
    const fixed = screen.getByRole('region', { name: '固定費' })
    expect(fixed).toHaveTextContent(label)
    expect(fixed).not.toHaveTextContent('抑止記録あり')
    if (status === 'unknown') expect(fixed).not.toHaveTextContent('計上記録:')
  })
  it('成功0件でも4見出しと空説明・導線が残る', async () => {
    setup({ ...detail(), menuEntries: [], events: [], fixedCosts: [], finance: { income: 0, expense: 0, balance: 0, incomes: [], expenses: [] } })
    renderDay()
    for (const name of ['今週の献立', 'イベント', '収支', '固定費']) await expand(name)
    expect(screen.getAllByRole('button', { name: /0件/ })).toHaveLength(4)
    expect(screen.getByRole('link', { name: 'イベントを追加' })).toBeVisible()
    expect(screen.getByText('この日の固定費はありません')).toBeVisible()
  })
  it('読み込みとHTTP失敗は0件にせず、再試行で取得できる', async () => {
    setup()
    let release!: () => void
    let fail = true
    server.use(http.get('/api/dashboard/day-detail', async () => {
      if (fail) { await new Promise<void>(resolve => { release = resolve }); return HttpResponse.json({}, { status: 500 }) }
      return HttpResponse.json(detail())
    }))
    renderDay()
    await waitFor(() => expect(release).toBeDefined())
    expect(screen.queryByText(/0件/)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('読み込み中')
    release()
    expect(await screen.findByRole('alert')).toHaveTextContent('日付詳細を取得できませんでした')
    expect(screen.queryByText(/0件/)).not.toBeInTheDocument()
    fail = false
    await userEvent.setup().click(screen.getByRole('button', { name: '再試行' }))
    await screen.findByRole('button', { name: /^収支 3件/ })
  })
  it('旧日付の遅延応答は新日付へ混入せず、新日付も全閉になる', async () => {
    setup()
    let release!: () => void
    server.use(http.get('/api/dashboard/day-detail', async ({ request }) => {
      const value = new URL(request.url).searchParams.get('date')!
      if (value === date) await new Promise<void>(resolve => { release = resolve })
      return HttpResponse.json({ ...detail(value), events: [{ ...event, name: value }] })
    }))
    const view = renderDay()
    await waitFor(() => expect(release).toBeDefined())
    view.rerender(<MemoryRouter><DayDetailModal day={calendarDay('2026-11-08')} onClose={vi.fn()} /></MemoryRouter>)
    await expand('イベント')
    expect(screen.getByRole('button', { name: 'イベント「2026-11-08」の詳細' })).toBeVisible()
    release()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'イベント「2026-11-07」の詳細' })).not.toBeInTheDocument())
  })
  it.each(['イベント', '今週の献立'])('StrictModeで%sの子を閉じても親は残り、元の行へfocus復帰する', async section => {
    setup()
    function Fixture() {
      const [open, setOpen] = useState(false)
      return <><button onClick={() => setOpen(true)}>日付起点</button>{open && <DayDetailModal day={calendarDay()} onClose={() => setOpen(false)} />}</>
    }
    render(<StrictMode><MemoryRouter><Fixture /></MemoryRouter></StrictMode>)
    const user = userEvent.setup()
    const trigger = screen.getByRole('button', { name: '日付起点' })
    await user.click(trigger)
    await expand(section)
    const row = screen.getByRole('button', { name: section === 'イベント' ? 'イベント「' + event.name + '」の詳細' : 'レシピ「' + recipe.title + '」の詳細' })
    await user.click(row)
    const child = await screen.findByRole('dialog', { name: section === 'イベント' ? 'イベント詳細' : 'レシピ詳細' })
    expect(child).toBeVisible()
    expect(document.querySelector('.day-detail-overlay')).toHaveAttribute('inert')
    expect(within(child).queryByRole('button', { name: '編集' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(child).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: '日次詳細' })).toBeInTheDocument()
    expect(row).toHaveFocus()
    expect(document.querySelector('.day-detail-overlay')).not.toHaveAttribute('inert')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '日次詳細' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
  it.each(['日付詳細を閉じる', '閉じる', '背景'])('%sだけで閉じ、内側clickでは閉じない', async action => {
    setup()
    const onClose = vi.fn()
    renderDay(date, onClose)
    await screen.findByRole('button', { name: /^収支 3件/ })
    await userEvent.setup().click(screen.getByRole('heading', { name: date + ' の詳細' }))
    expect(onClose).not.toHaveBeenCalled()
    if (action === '背景') fireEvent.click(screen.getByRole('dialog', { name: '日次詳細' }))
    else await userEvent.setup().click(screen.getByRole('button', { name: action }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('レシピ照会中の連打は一度だけ取得し、日付変更後の応答は子を開かない', async () => {
    setup()
    let release!: () => void
    let calls = 0
    server.use(http.get('/api/recipes', async () => {
      calls++
      await new Promise<void>(resolve => { release = resolve })
      return HttpResponse.json([recipe])
    }))
    const view = renderDay()
    await expand('今週の献立')
    const row = screen.getByRole('button', { name: 'レシピ「' + recipe.title + '」の詳細' })
    fireEvent.click(row); fireEvent.click(row)
    await waitFor(() => expect(release).toBeDefined())
    expect(calls).toBe(1)
    expect(row).toBeDisabled()
    view.rerender(<MemoryRouter><DayDetailModal day={calendarDay('2026-11-08')} onClose={vi.fn()} /></MemoryRouter>)
    await screen.findByRole('button', { name: /^収支 3件/ })
    release()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'レシピ詳細' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^今週の献立 1件/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('unknownに不正な計上記録が付いていても私的な実額と日付を表示しない', async () => {
    const data = detail()
    data.fixedCosts[0].postingStatus = 'unknown'
    data.fixedCosts[0].postedExpense = { id: 777, amount: 987654, expenseDate: '2025-01-02' }
    setup(data); renderDay(); await expand('固定費')
    const fixed = screen.getByRole('region', { name: '固定費' })
    expect(fixed).toHaveTextContent('予定額: 90,000円')
    expect(fixed).toHaveTextContent('確認できません')
    expect(fixed).not.toHaveTextContent('987,654')
    expect(fixed).not.toHaveTextContent('2025-01-02')
    expect(fixed).not.toHaveTextContent('計上記録:')
  })

  it('遅いレシピ応答は後から選んだイベントを上書きせず、イベント起点と再照会を維持する', async () => {
    setup()
    const originalGet = apiClient.get.bind(apiClient)
    let resolveFirst!: (response: AxiosResponse) => void
    let resolveSecond!: (response: AxiosResponse) => void
    const first = new Promise<AxiosResponse>(resolve => { resolveFirst = resolve })
    const second = new Promise<AxiosResponse>(resolve => { resolveSecond = resolve })
    let recipeRequests = 0
    const get = vi.spyOn(apiClient, 'get').mockImplementation((url, config) => {
      if (url === '/recipes') return ++recipeRequests === 1 ? first : second
      return originalGet(url, config)
    })
    const response: AxiosResponse = { data: [recipe], status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() } }
    try {
      renderDay()
      await expand('今週の献立')
      await expand('イベント')
      const user = userEvent.setup()
      const recipeRow = screen.getByRole('button', { name: 'レシピ「' + recipe.title + '」の詳細' })
      const eventRow = screen.getByRole('button', { name: 'イベント「' + event.name + '」の詳細' })
      await user.click(recipeRow)
      expect(recipeRequests).toBe(1)
      expect(recipeRow).toBeDisabled()
      await user.click(eventRow)
      const eventDialog = await screen.findByRole('dialog', { name: 'イベント詳細' })
      await act(async () => { resolveFirst(response); await first })
      expect(eventDialog).toBeVisible()
      expect(screen.queryByRole('dialog', { name: 'レシピ詳細' })).not.toBeInTheDocument()
      await user.keyboard('{Escape}')
      expect(screen.getByRole('dialog', { name: '日次詳細' })).toBeVisible()
      expect(eventRow).toHaveFocus()
      expect(recipeRow).toBeEnabled()
      await user.click(recipeRow)
      expect(recipeRequests).toBe(2)
      await act(async () => { resolveSecond(response); await second })
      const recipeDialog = await screen.findByRole('dialog', { name: 'レシピ詳細' })
      expect(recipeDialog).toBeVisible()
      await user.keyboard('{Escape}')
      expect(recipeRow).toHaveFocus()
    } finally {
      get.mockRestore()
      resolveFirst(response)
      resolveSecond(response)
    }
  })

})

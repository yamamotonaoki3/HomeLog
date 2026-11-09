import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse, delay } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
import { CalendarPanel, type CalendarDay } from '../../components/dashboard/CalendarPanel'

const event = { id: 11, name: '[E2E_TEST] 長いイベント', isRecurring: false, recurrenceType: 'none' as const, eventDate: '2026-09-25' }
const day = (overrides: Partial<CalendarDay> = {}): CalendarDay => ({ date: '2026-09-25', fixedCosts: [], events: [], income: 0, expense: 0, balance: 0, ...overrides })
function setup(days: CalendarDay[], props: Partial<Parameters<typeof CalendarPanel>[0]> = {}) {
  server.use(http.get('/api/dashboard/calendar', () => HttpResponse.json({ days })))
  const onSelectDate = vi.fn()
  render(<CalendarPanel onSelectDate={onSelectDate} {...props} />)
  return { onSelectDate, user: userEvent.setup() }
}
describe('#431 CalendarPanel', () => {
  it('年月を日本語で表示し、今日だけを現在の日付として伝える', async () => {
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date())
    const [year, month] = today.split('-').map(Number)
    setup([day({ date: today }), day({ date: '2000-01-01' })])
    expect(screen.getByText(`${year}年${month}月`)).toBeVisible()
    expect(await screen.findByRole('button', { name: today })).toHaveAttribute('aria-current', 'date')
    expect(screen.getByRole('button', { name: '2000-01-01' })).not.toHaveAttribute('aria-current')
    expect(screen.getByText('日付を選ぶと詳細を確認できます。マークは各種類につき最大1つ。')).toBeVisible()
  })
  it('複数件でもカテゴリごと1ドットと4種類のdot凡例だけを表示する', async () => {
    setup([day({ events: [event, { ...event, id: 12 }], fixedCosts: ['家賃', '光熱費'], income: 5000, expense: 1500 })])
    const cell = await screen.findByRole('button', { name: /2026-09-25.*イベントあり.*収入あり.*支出あり.*固定費あり/ })
    expect(cell.querySelectorAll('.calendar-dot')).toHaveLength(4)
    expect(within(cell).queryByText(/円|家賃|長いイベント/)).not.toBeInTheDocument()
    expect(within(screen.getByLabelText('カレンダーの凡例')).getAllByRole('listitem').map(el => el.textContent)).toEqual(['イベント', '収入', '支出', '固定費'])
    expect(screen.queryByRole('button', { name: /イベント「/ })).not.toBeInTheDocument()
  })
  it('表示設定OFFはdotと日付読み上げに反映し、固定費は維持する', async () => {
    setup([day({ events: [event], income: 1000, expense: 500, fixedCosts: ['家賃'] })], { showEvents: false, showIncome: false })
    const cell = await screen.findByRole('button', { name: /2026-09-25/ })
    expect(cell).not.toHaveAccessibleName(/イベントあり|収入あり/)
    expect(cell).toHaveAccessibleName(/支出あり.*固定費あり/)
    expect(cell.querySelectorAll('.calendar-dot')).toHaveLength(2)
  })
  it('空日も日付からクリックとキーボードで詳細を選択できる', async () => {
    const target = day()
    const { user, onSelectDate } = setup([target])
    const cell = await screen.findByRole('button', { name: '2026-09-25' })
    expect(cell.querySelectorAll('.calendar-dot')).toHaveLength(0)
    await user.click(cell)
    await user.keyboard('{Enter} ')
    expect(onSelectDate).toHaveBeenCalledTimes(3)
    expect(onSelectDate).toHaveBeenLastCalledWith(target)
  })
  it('月取得の失敗は空成功にせず再試行できる', async () => {
    let failed = true
    server.use(http.get('/api/dashboard/calendar', () => failed ? HttpResponse.json({}, { status: 500 }) : HttpResponse.json({ days: [day()] })))
    render(<CalendarPanel onSelectDate={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('カレンダーを取得できませんでした')
    failed = false
    await userEvent.setup().click(screen.getByRole('button', { name: '再試行' }))
    await screen.findByRole('button', { name: '2026-09-25' })
  })
  it('月移動後の旧月遅延応答は混入しない', async () => {
    let first = true
    server.use(http.get('/api/dashboard/calendar', async () => {
      if (first) { first = false; await delay(80); return HttpResponse.json({ days: [day({ date: '2026-09-25' })] }) }
      return HttpResponse.json({ days: [day({ date: '2026-10-25' })] })
    }))
    render(<CalendarPanel onSelectDate={vi.fn()} />)
    await userEvent.setup().click(screen.getByRole('button', { name: '翌月' }))
    await screen.findByRole('button', { name: '2026-10-25' })
    await waitFor(() => expect(screen.queryByRole('button', { name: '2026-09-25' })).not.toBeInTheDocument())
  })
})

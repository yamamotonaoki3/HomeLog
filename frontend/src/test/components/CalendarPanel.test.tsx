import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
import { CalendarPanel, type CalendarDay } from '../../components/dashboard/CalendarPanel'
import type { Event } from '../../api/eventTypes'

function day(overrides: Partial<CalendarDay> & { date: string }): CalendarDay {
  return { fixedCosts: [], events: [], income: 0, expense: 0, balance: 0, ...overrides }
}

const sharedEvent: Event = {
  id: 11,
  name: '通院',
  eventDate: '2026-09-01',
  isAllDay: false,
  startTime: '09:00',
  endTime: '10:30',
  recurrenceType: 'monthly',
  notifyEnabled: true,
  defaultAmount: 3000,
  showOnDashboard: true,
  personal: false,
  editable: true,
}

const personalEvent: Event = {
  ...sharedEvent,
  id: 12,
  name: '自分の予定',
  eventDate: '2026-09-25',
  isAllDay: true,
  startTime: null,
  endTime: null,
  recurrenceType: 'none',
  notifyEnabled: false,
  defaultAmount: null,
  personal: true,
}

function setup(days: CalendarDay[], props: Partial<Parameters<typeof CalendarPanel>[0]> = {}) {
  server.use(
    http.get('/api/dashboard/calendar', () => HttpResponse.json({ days })),
    http.get('/api/events', () => HttpResponse.json([sharedEvent, personalEvent])),
  )
  const onSelectDate = vi.fn()
  render(<CalendarPanel onSelectDate={onSelectDate} {...props} />)
  return { onSelectDate, user: userEvent.setup() }
}

const calendarEvent = (event: Event) => ({
  id: event.id,
  name: event.name,
  isRecurring: event.recurrenceType !== 'none',
  recurrenceType: event.recurrenceType,
  eventDate: event.eventDate,
})

describe('CalendarPanel', () => {
  it('同じ日の収入と支出をそれぞれ方向付きで表示し、0円の側は表示しない', async () => {
    setup([
      day({ date: '2026-09-25', income: 5000, expense: 1500, balance: 3500 }),
      day({ date: '2026-09-26', expense: 400, balance: -400 }),
      day({ date: '2026-09-27' }),
    ])
    const both = await screen.findByRole('button', { name: '2026-09-25' })
    expect(within(both).getByText('+5000円')).toHaveClass('calendar-income')
    expect(within(both).getByText('-1500円')).toHaveClass('calendar-expense')
    const expenseOnly = screen.getByRole('button', { name: '2026-09-26' })
    expect(within(expenseOnly).queryByText(/^\+/)).not.toBeInTheDocument()
    expect(within(expenseOnly).getByText('-400円')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: '2026-09-27' })).queryByText(/円/)).not.toBeInTheDocument()
  })

  it('表示設定で収入・支出・イベントを個別に非表示にできる', async () => {
    setup([day({ date: '2026-09-25', income: 5000, expense: 1500, events: [calendarEvent(sharedEvent)] })], { showIncome: false, showEvents: false })
    const cell = await screen.findByRole('button', { name: '2026-09-25' })
    expect(within(cell).queryByText('+5000円')).not.toBeInTheDocument()
    expect(within(cell).getByText('-1500円')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'イベント「通院」の詳細' })).not.toBeInTheDocument()
  })

  it('日付ボタンは従来どおり日次詳細を開き、イベントボタンは日付クリックと競合しない', async () => {
    const target = day({ date: '2026-09-25', events: [calendarEvent(sharedEvent)] })
    const { onSelectDate, user } = setup([target])
    await user.click(await screen.findByRole('button', { name: 'イベント「通院」の詳細' }))
    expect(onSelectDate).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog', { name: 'イベント詳細' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog', { name: 'イベント詳細' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '2026-09-25' }))
    expect(onSelectDate).toHaveBeenCalledWith(target)
  })

  it('イベント詳細は見出しクリックでは閉じず、オーバーレイクリックで閉じる', async () => {
    const { user } = setup([day({ date: '2026-09-25', events: [calendarEvent(sharedEvent)] })])
    await user.click(await screen.findByRole('button', { name: 'イベント「通院」の詳細' }))
    const dialog = await screen.findByRole('dialog', { name: 'イベント詳細' })
    await user.click(within(dialog).getByRole('heading', { name: '通院' }))
    expect(dialog).toBeInTheDocument()
    await user.click(dialog)
    expect(screen.queryByRole('dialog', { name: 'イベント詳細' })).not.toBeInTheDocument()
  })

  it('イベント詳細モーダルに日付・時間帯・繰り返し・通知・既定金額・区分を表示する', async () => {
    const { user } = setup([day({ date: '2026-09-25', events: [calendarEvent(sharedEvent), calendarEvent(personalEvent)] })])
    await user.click(await screen.findByRole('button', { name: 'イベント「通院」の詳細' }))
    const dialog = await screen.findByRole('dialog', { name: 'イベント詳細' })
    expect(within(dialog).getByRole('heading', { name: '通院' })).toBeInTheDocument()
    expect(await within(dialog).findByText('2026-09-25')).toBeInTheDocument()
    expect(within(dialog).getByText('09:00〜10:30')).toBeInTheDocument()
    expect(within(dialog).getByText('毎月')).toBeInTheDocument()
    expect(within(dialog).getByText('あり')).toBeInTheDocument()
    expect(within(dialog).getByText('3000円')).toBeInTheDocument()
    expect(within(dialog).getByText('世帯共有')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'イベント詳細' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'イベント「自分の予定」の詳細' }))
    const personal = await screen.findByRole('dialog', { name: 'イベント詳細' })
    expect(await within(personal).findByText('終日')).toBeInTheDocument()
    expect(within(personal).getByText('単発')).toBeInTheDocument()
    expect(within(personal).getByText('なし')).toBeInTheDocument()
    expect(within(personal).getByText('未設定')).toBeInTheDocument()
    expect(within(personal).getByText('個人')).toBeInTheDocument()
  })

  it('イベント一覧に該当IDが無い場合は詳細を取得できない旨を表示する', async () => {
    const { user } = setup([day({ date: '2026-09-25', events: [{ ...calendarEvent(sharedEvent), id: 999 }] })])
    await user.click(await screen.findByRole('button', { name: 'イベント「通院」の詳細' }))
    const dialog = await screen.findByRole('dialog', { name: 'イベント詳細' })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('イベントの詳細を取得できませんでした')
  })
})

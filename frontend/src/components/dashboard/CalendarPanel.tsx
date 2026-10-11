import { useEffect, useState } from 'react'
import { apiClient } from '../../api/client'
import type { Event } from '../../api/eventTypes'
import { EventDetailModal } from './EventDetailModal'

export interface CalendarEvent {
  id: number
  name: string
  isRecurring: boolean
  recurrenceType: Event['recurrenceType']
  eventDate: string
}

export interface CalendarDay {
  date: string
  fixedCosts: string[]
  events: CalendarEvent[]
  income: number
  expense: number
  balance: number
}

interface CalendarResponse {
  days: CalendarDay[]
}

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function addMonths(month: string, amount: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(year, monthNumber - 1 + amount, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function CalendarPanel({
  onSelectDate,
  showEvents = true,
  showIncome = true,
  showExpense = true,
}: {
  onSelectDate: (day: CalendarDay) => void
  showEvents?: boolean
  showIncome?: boolean
  showExpense?: boolean
}) {
  const [month, setMonth] = useState(currentMonth)
  const [data, setData] = useState<CalendarResponse>({ days: [] })
  const [selectedEvent, setSelectedEvent] = useState<{ event: CalendarEvent; date: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    apiClient.get<CalendarResponse>('/dashboard/calendar', { params: { month } }).then((response) => {
      if (!cancelled) setData(response.data)
    }).catch(() => {
      if (!cancelled) setData({ days: [] })
    })
    return () => { cancelled = true }
  }, [month])

  return <section className="calendar-panel">
    <div className="calendar-toolbar">
      <button type="button" aria-label="前月" onClick={() => setMonth((value) => addMonths(value, -1))}>◀</button>
      <h2>月間カレンダー</h2>
      <span>{month.replace('-', '年')}月</span>
      <button type="button" aria-label="次月" onClick={() => setMonth((value) => addMonths(value, 1))}>▶</button>
    </div>
    <div className="calendar-grid">
      {/* イベントボタンを日付ボタンの中に入れるとボタンの入れ子になりクリックも競合するため、セル内で兄弟要素として並べる */}
      {data.days.map((day) => <div className="calendar-day" key={day.date}>
        <button type="button" className="calendar-day-date" aria-label={day.date} onClick={() => onSelectDate(day)}>
          <strong>{Number(day.date.slice(-2))}</strong>
          {day.fixedCosts.map((fixedCost) => <span key={`fixed-${fixedCost}`}>●{fixedCost}</span>)}
          {showIncome && day.income > 0 && <span className="calendar-income">+{day.income}円</span>}
          {showExpense && day.expense > 0 && <span className="calendar-expense">-{day.expense}円</span>}
        </button>
        {showEvents && day.events.map((event) => <button
          type="button"
          className="calendar-event"
          key={`event-${event.id}`}
          aria-label={`イベント「${event.name}」の詳細`}
          onClick={() => setSelectedEvent({ event, date: day.date })}
        >
          {event.isRecurring ? '📌' : ''}{event.name}
        </button>)}
      </div>)}
    </div>
    {selectedEvent && <EventDetailModal event={selectedEvent.event} date={selectedEvent.date} onClose={() => setSelectedEvent(null)} />}
  </section>
}

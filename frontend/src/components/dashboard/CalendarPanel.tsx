import { useEffect, useState } from 'react'
import { apiClient } from '../../api/client'

export interface CalendarDay {
  date: string
  fixedCosts: string[]
  events: { name: string; isRecurring: boolean }[]
  balance: number
}

interface CalendarResponse {
  days: CalendarDay[]
  notificationCount: number
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

export function CalendarPanel({ onSelectDate }: { onSelectDate: (day: CalendarDay) => void }) {
  const [month, setMonth] = useState(currentMonth)
  const [data, setData] = useState<CalendarResponse>({ days: [], notificationCount: 0 })

  useEffect(() => {
    let cancelled = false
    apiClient.get<CalendarResponse>('/dashboard/calendar', { params: { month } }).then((response) => {
      if (!cancelled) setData(response.data)
    }).catch(() => {
      if (!cancelled) setData({ days: [], notificationCount: 0 })
    })
    return () => { cancelled = true }
  }, [month])

  return <section className="calendar-panel">
    <div className="calendar-toolbar">
      <button type="button" aria-label="前月" onClick={() => setMonth((value) => addMonths(value, -1))}>◀</button>
      <h2>月間カレンダー</h2>
      <span>{month.replace('-', '年')}月</span>
      <button type="button" aria-label="次月" onClick={() => setMonth((value) => addMonths(value, 1))}>▶</button>
      <span className="notification-badge">通知: {data.notificationCount}件</span>
    </div>
    <div className="calendar-grid">
      {data.days.map((day) => <button type="button" className="calendar-day" key={day.date} aria-label={day.date} onClick={() => onSelectDate(day)}>
        <strong>{Number(day.date.slice(-2))}</strong>
        {day.events.map((event) => <span key={`event-${event.name}`}>{event.isRecurring ? '📌' : ''}{event.name}</span>)}
        {day.fixedCosts.map((fixedCost) => <span key={`fixed-${fixedCost}`}>●{fixedCost}</span>)}
        <span>{day.balance >= 0 ? '+' : ''}{day.balance}円</span>
      </button>)}
    </div>
  </section>
}

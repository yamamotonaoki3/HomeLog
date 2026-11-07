import { useEffect, useState } from 'react'
import { apiClient } from '../../api/client'
import type { Event } from '../../api/eventTypes'

export interface CalendarEvent {
  id: number; name: string; isRecurring: boolean; recurrenceType: Event['recurrenceType']; eventDate: string
}
export interface CalendarDay {
  date: string; fixedCosts: string[]; events: CalendarEvent[]; income: number; expense: number; balance: number
}
interface Props {
  onSelectDate: (day: CalendarDay) => void
  showEvents?: boolean; showIncome?: boolean; showExpense?: boolean
}
interface CalendarResponse { days: CalendarDay[] }
const CATEGORIES = [
  { key: 'events', label: 'イベント' }, { key: 'income', label: '収入' },
  { key: 'expense', label: '支出' }, { key: 'fixed', label: '固定費' },
] as const
type Category = typeof CATEGORIES[number]['key']
type CalendarState = { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: CalendarResponse }
function currentMonth() {
  const now = new Date()
  return String(now.getFullYear()) + '-' + String(now.getMonth() + 1).padStart(2, '0')
}
function addMonths(month: string, amount: number) {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(year, monthNumber - 1 + amount, 1)
  return String(date.getFullYear()) + '-' + String(date.getMonth() + 1).padStart(2, '0')
}
function MonthGrid({ month, onSelectDate, showEvents = true, showIncome = true, showExpense = true }: Props & { month: string }) {
  const [state, setState] = useState<CalendarState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    apiClient.get<CalendarResponse>('/dashboard/calendar', { params: { month }, signal: controller.signal })
      .then(response => { if (!controller.signal.aborted) setState({ status: 'ok', data: response.data }) })
      .catch(() => { if (!controller.signal.aborted) setState({ status: 'error' }) })
    return () => controller.abort()
  }, [month, attempt])
  if (state.status === 'loading') return <p role="status">カレンダーを読み込み中...</p>
  if (state.status === 'error') return <div><p role="alert">カレンダーを取得できませんでした</p><button type="button" onClick={() => { setState({ status: 'loading' }); setAttempt(value => value + 1) }}>再試行</button></div>
  const leading = new Date(month + '-01T12:00:00').getDay()
  return <>
    <div className="calendar-weekdays" aria-hidden="true">{['日', '月', '火', '水', '木', '金', '土'].map(label => <span key={label}>{label}</span>)}</div>
    <div className="calendar-grid">
      {Array.from({ length: leading }, (_, i) => <span key={'empty-' + i} aria-hidden="true" />)}
      {state.data.days.map(day => {
        const visible: Record<Category, boolean> = { events: showEvents && day.events.length > 0, income: showIncome && day.income > 0, expense: showExpense && day.expense > 0, fixed: day.fixedCosts.length > 0 }
        const categories = CATEGORIES.filter(category => visible[category.key])
        return <button type="button" className="calendar-day calendar-day-date" key={day.date}
          aria-label={day.date + (categories.length ? '、' + categories.map(category => category.label + 'あり').join('、') : '')}
          onClick={() => onSelectDate(day)}>
          <strong>{Number(day.date.slice(-2))}</strong>
          <span className="calendar-dots" aria-hidden="true">{categories.map(category => <span className={'calendar-dot calendar-dot-' + category.key} data-category={category.key} key={category.key} />)}</span>
        </button>
      })}
    </div>
  </>
}
export function CalendarPanel(props: Props) {
  const [month, setMonth] = useState(currentMonth)
  return <section className="calendar-panel">
    <div className="calendar-toolbar">
      <button type="button" aria-label="前月" onClick={() => setMonth(value => addMonths(value, -1))}>◀</button>
      <h2>月間カレンダー</h2><span>{month.replace('-', '年')}月</span>
      <button type="button" aria-label="次月" onClick={() => setMonth(value => addMonths(value, 1))}>▶</button>
    </div>
    <MonthGrid key={month} month={month} {...props} />
    <ul className="calendar-legend" aria-label="カレンダーの凡例">{CATEGORIES.map(category => <li key={category.key}>
      <span className={'calendar-dot calendar-dot-' + category.key} aria-hidden="true" />{category.label}
    </li>)}</ul>
  </section>
}

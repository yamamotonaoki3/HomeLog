import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../../api/client'
import type { Expense } from '../../api/kakeiboTypes'
import type { MenuEntry } from '../../api/kondateTypes'
import type { CalendarDay } from './CalendarPanel'

function mondayOf(dateValue: string): string {
  const [year, month, day] = dateValue.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}

export function DayDetailModal({ day, onClose }: { day: CalendarDay; onClose: () => void }) {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [menuEntries, setMenuEntries] = useState<MenuEntry[]>([])
  const week = mondayOf(day.date)
  useEffect(() => {
    Promise.all([apiClient.get<Expense[]>('/expenses'), apiClient.get<MenuEntry[]>('/menu-entries', { params: { weekStartDate: week } })])
      .then(([expenseResponse, menuResponse]) => {
        setExpenses(expenseResponse.data.filter((expense) => expense.expenseDate === day.date))
        setMenuEntries(menuResponse.data)
      }).catch(() => undefined)
  }, [day.date, week])
  return <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="日次詳細">
    <div className="modal"><h2>{day.date} の詳細</h2><p>収支: {day.balance}円</p>
      <h3>支出一覧</h3>{expenses.length ? expenses.map((expense) => <p key={expense.id}>{expense.purpose || '支出'}: {expense.amount}円</p>) : <p>なし</p>}
      <Link to="/kakeibo">支出を登録</Link><h3>イベント</h3>{day.events.length ? day.events.map((event) => <p key={event.name}>{event.name}</p>) : <p>なし</p>}
      <Link to="/events">イベントを追加</Link><h3>この週の献立</h3>{menuEntries.length ? menuEntries.map((entry) => <p key={entry.id}>{entry.recipeTitle ?? entry.freeTextMemo}</p>) : <p>なし</p>}
      <Link to={`/menu?week=${week}`}>この週の献立を編集</Link><button type="button" onClick={onClose}>閉じる</button>
    </div>
  </div>
}

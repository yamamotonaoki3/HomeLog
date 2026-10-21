import { useEffect, useState } from 'react'
import { isAxiosError } from 'axios'
import { apiClient } from '../../api/client'
import type { Event, SummaryPeriod } from '../../api/eventTypes'

type Summary = { status: 'loading' | 'excluded' | 'error' } | { status: 'ok'; total: number }

export function EventSummary({ event }: { event: Event }) {
  const [period, setPeriod] = useState<SummaryPeriod>('year')
  const requestKey = `${event.id}:${event.showOnDashboard}:${period}`
  const [result, setResult] = useState<{ key: string; summary: Summary } | null>(null)
  const summary: Summary = result?.key === requestKey ? result.summary : { status: 'loading' }


  useEffect(() => {
    let cancelled = false
    apiClient.get<{ total: number }>(`/events/${event.id}/summary`, { params: { period } })
      .then(({ data }) => { if (!cancelled) setResult({ key: requestKey, summary: { status: 'ok', total: data.total } }) })
      .catch((err: unknown) => {
        if (!cancelled) setResult({ key: requestKey, summary: { status: isAxiosError(err) && err.response?.status === 404 ? 'excluded' : 'error' } })
      })
    return () => { cancelled = true }
  }, [event.id, period, requestKey])

  return <section className="event-summary" aria-label="支出集計">
        <label htmlFor="event-detail-period">集計対象期間</label>
        <select id="event-detail-period" value={period} onChange={(e) => setPeriod(e.target.value as SummaryPeriod)}>
          <option value="year">今年</option><option value="month">今月</option>
        </select>
        <p aria-live="polite">支出合計：<span>{summary.status === 'ok' ? `${summary.total}円` : summary.status === 'loading' ? '読み込み中...' : summary.status === 'excluded' ? '集計対象外' : '取得失敗'}</span></p>
        {summary.status === 'error' && <p role="alert">イベントの集計取得に失敗しました。時間をおいて再度お試しください</p>}
  </section>
}

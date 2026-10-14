import { useEffect, useState } from 'react'
import { isAxiosError } from 'axios'
import { apiClient } from '../../api/client'
import { RECURRENCE_LABELS, timeRangeLabel, type Event, type SummaryPeriod } from '../../api/eventTypes'

type Summary = { status: 'loading' | 'excluded' | 'error' } | { status: 'ok'; total: number }

export function EventDetailModal({ event, onClose, onEdit, onDelete, onToggle, toggling }: {
  event: Event
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  onToggle: (event: Event) => Promise<void>
  toggling: boolean
}) {
  const [period, setPeriod] = useState<SummaryPeriod>('year')
  const requestKey = `${event.id}:${event.showOnDashboard}:${period}`
  const [result, setResult] = useState<{ key: string; summary: Summary } | null>(null)
  const summary: Summary = result?.key === requestKey ? result.summary : { status: 'loading' }

  useEffect(() => {
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    apiClient.get<{ total: number }>(`/events/${event.id}/summary`, { params: { period } })
      .then(({ data }) => { if (!cancelled) setResult({ key: requestKey, summary: { status: 'ok', total: data.total } }) })
      .catch((err: unknown) => {
        if (!cancelled) setResult({ key: requestKey, summary: { status: isAxiosError(err) && err.response?.status === 404 ? 'excluded' : 'error' } })
      })
    return () => { cancelled = true }
  }, [event.id, period, requestKey])

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="イベント詳細"
      onClick={(clickEvent) => { if (clickEvent.target === clickEvent.currentTarget) onClose() }}>
      <div className="modal event-modal">
        <h2>{event.name}</h2>
        <dl className="event-detail-list">
          <dt>日時</dt><dd>{event.eventDate}（{timeRangeLabel(event)}）</dd>
          <dt>繰り返し</dt><dd>{RECURRENCE_LABELS[event.recurrenceType]}</dd>
          <dt>公開範囲</dt><dd>{event.personal ? '個人' : '世帯共有'}</dd>
          <dt>通知</dt><dd>{event.notifyEnabled ? '通知する' : '通知しない'}</dd>
          <dt>デフォルト金額</dt><dd>{event.defaultAmount === null ? '未設定' : `${event.defaultAmount}円`}</dd>
          <dt>ダッシュボード表示</dt>
          <dd>{event.editable ? (
            <button type="button" className="btn btn-secondary" aria-pressed={event.showOnDashboard}
              disabled={toggling} onClick={() => onToggle(event)}>{event.showOnDashboard ? '表示する' : '表示しない'}</button>
          ) : <span>{event.showOnDashboard ? '表示する' : '表示しない'}</span>}</dd>
        </dl>
        <label htmlFor="event-detail-period">集計対象期間</label>
        <select id="event-detail-period" value={period} onChange={(e) => setPeriod(e.target.value as SummaryPeriod)}>
          <option value="year">今年</option><option value="month">今月</option>
        </select>
        <p aria-live="polite">支出合計：<span>{summary.status === 'ok' ? `${summary.total}円` : summary.status === 'loading' ? '読み込み中...' : summary.status === 'excluded' ? '集計対象外' : '取得失敗'}</span></p>
        {summary.status === 'error' && <p role="alert">イベントの集計取得に失敗しました。時間をおいて再度お試しください</p>}
        <div className="modal-actions">
          {event.editable && <>
            <button type="button" className="btn btn-primary" onClick={onEdit} disabled={toggling}>編集</button>
            <button type="button" className="btn btn-secondary" onClick={onDelete} disabled={toggling}>削除</button>
          </>}
          <button type="button" className="btn btn-secondary" onClick={onClose} autoFocus>閉じる</button>
        </div>
      </div>
    </div>
  )
}

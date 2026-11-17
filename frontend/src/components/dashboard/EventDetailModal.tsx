import { useEffect, useState } from 'react'
import { apiClient } from '../../api/client'
import { RECURRENCE_LABELS, timeRangeLabel, type Event } from '../../api/eventTypes'
import { useDialog } from '../../hooks/useDialog'
import type { CalendarEvent } from './CalendarPanel'

// カレンダーのイベントボタンから開く詳細モーダル。詳細はGET /api/events(世帯共有+本人所有のみ)から
// IDで引くため、カレンダーAPIと同じ権限境界の範囲でしか表示されない。
export function EventDetailModal({ event, date, onClose }: { event: CalendarEvent; date: string; onClose: () => void }) {
  return <EventDetailContent key={event.id} event={event} date={date} onClose={onClose} />
}

function EventDetailContent({ event, date, onClose }: { event: CalendarEvent; date: string; onClose: () => void }) {
  const modalRef = useDialog(onClose, '[data-event-close]')
  const [detail, setDetail] = useState<Event | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    apiClient
      .get<Event[]>('/events', { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return
        const found = response.data.find((item) => item.id === event.id)
        if (found) setDetail(found)
        else setError(true)
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true)
      })
    return () => {
      controller.abort()
    }
  }, [event.id])

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="イベント詳細"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal day-event-detail" ref={modalRef}>
        <h2>{detail?.name ?? event.name}</h2>
        {error ? (
          <p role="alert" className="error">イベントの詳細を取得できませんでした</p>
        ) : !detail ? (
          <p>読み込み中...</p>
        ) : (
          <dl className="event-detail-list">
            <dt>日付</dt>
            <dd>{date}</dd>
            <dt>時間</dt>
            <dd>{timeRangeLabel(detail)}</dd>
            <dt>繰り返し</dt>
            <dd>{RECURRENCE_LABELS[detail.recurrenceType]}</dd>
            <dt>通知</dt>
            <dd>{detail.notifyEnabled ? 'あり' : 'なし'}</dd>
            <dt>既定金額</dt>
            <dd>{detail.defaultAmount != null ? `${detail.defaultAmount}円` : '未設定'}</dd>
            <dt>区分</dt>
            <dd>{detail.personal ? '個人' : '世帯共有'}</dd>
          </dl>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose} data-event-close>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}

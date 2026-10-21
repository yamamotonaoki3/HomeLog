import { useDialog } from '../../hooks/useDialog'
import { RECURRENCE_LABELS, timeRangeLabel, type Event } from '../../api/eventTypes'
import { EventSummary } from './EventSummary'

export function EventDetailModal({ event, onClose }: { event: Event; onClose: () => void }) {
  const dialogRef = useDialog(onClose, '[data-close]')
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="イベント詳細"
      onClick={(clickEvent) => { if (clickEvent.target === clickEvent.currentTarget) onClose() }}>
      <div ref={dialogRef} className="modal event-modal">
        <h2>{event.name}</h2>
        <dl className="event-detail-list">
          <dt>日時</dt><dd>{event.eventDate}（{timeRangeLabel(event)}）</dd>
          <dt>繰り返し</dt><dd>{RECURRENCE_LABELS[event.recurrenceType]}</dd>
          <dt>公開範囲</dt><dd>{event.personal ? '個人' : '世帯共有'}</dd>
          <dt>通知</dt><dd>{event.notifyEnabled ? '通知する' : '通知しない'}</dd>
          <dt>デフォルト金額</dt><dd>{event.defaultAmount === null ? '未設定' : `${event.defaultAmount}円`}</dd>
          <dt>ダッシュボード表示</dt><dd>{event.showOnDashboard ? '表示する' : '表示しない'}</dd>
        </dl>
        <EventSummary event={event} />
        <div className="modal-actions">
          <button data-close type="button" className="btn btn-secondary" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import { RECURRENCE_LABELS, timeRangeLabel, type Event } from '../api/eventTypes'
import { Toast } from '../components/Toast'
import { EventModal } from '../components/events/EventModal'
import { EventDetailModal } from '../components/events/EventDetailModal'

export function EventsPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [eventsLoaded, setEventsLoaded] = useState(false)
  const [modalTarget, setModalTarget] = useState<Event | null | undefined>(undefined)
  const [detailId, setDetailId] = useState<number | null>(null)
  const detailTrigger = useRef<HTMLButtonElement | null>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const restoreFocus = useCallback(() => {
    (detailTrigger.current?.isConnected ? detailTrigger.current : addButton.current)?.focus({ preventScroll: true })
  }, [])
  const closeDetail = useCallback(() => { setDetailId(null); restoreFocus() }, [restoreFocus])
  const [toast, setToast] = useState({ message: '', showKey: 0 })

  const showToast = useCallback((message: string) => {
    setToast((prev) => ({ message, showKey: prev.showKey + 1 }))
  }, [])

  const fetchEvents = useCallback(async () => {
    const response = await apiClient.get<Event[]>('/events')
    setEvents(response.data)
    setEventsLoaded(true)
    return response.data
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchEvents()
      .catch((err: unknown) => {
        if (cancelled) return
        showToast(getApiErrorMessage(err, 'イベントの取得に失敗しました。時間をおいて再度お試しください'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fetchEvents, showToast])

  const handleSaved = async () => {
    const wasEdit = modalTarget != null
    try {
      const latest = await fetchEvents()
      if (wasEdit && !latest.some((event) => event.id === modalTarget.id)) {
        setDetailId(null)
        requestAnimationFrame(restoreFocus)
      }
    } catch (err) {
      showToast(getApiErrorMessage(err, 'イベント一覧の取得に失敗しました'))
      throw err
    }
    if (!wasEdit) setDetailId(null)
    setModalTarget(undefined)
    showToast(wasEdit ? 'イベントを更新しました' : 'イベントを登録しました')
  }

  const detailEvent = events.find((event) => event.id === detailId)

  if (loading) {
    return <p>読み込み中...</p>
  }

  return (
    <div className="page events-page">
      <div className="panel" data-testid="events-panel">
        <div className="toolbar">
          <h2>イベント一覧</h2>
          <button ref={addButton} type="button" className="btn btn-primary event-register-button" onClick={() => setModalTarget(null)}>
            イベントを登録
          </button>
        </div>
        <div className="events-list">
          {!eventsLoaded && <p role="status">イベント一覧を確認できません</p>}
          {events.length === 0 ? (eventsLoaded && (
            <div className="events-empty">
              <p>イベントはありません</p>
              <p>イベントを登録すると、予定を一覧で確認できます。</p>
            </div>
          )) : (
            <ul className="event-list" aria-label="イベント">
              {events.map((event) => (
                <li key={event.id}>
                <button type="button" className="list-row-button event-list-row" aria-label={`${event.name}の詳細`} aria-describedby={`event-description-${event.id}`}
                  onClick={(clickEvent) => { detailTrigger.current = clickEvent.currentTarget; if (event.editable) { setDetailId(null); setModalTarget(event) } else setDetailId(event.id) }}>
                  <span className="event-date-block">
                    <time dateTime={event.eventDate}>
                      <span className="event-date-year">{event.eventDate.slice(0, 4)}年</span>
                      <span className="event-date-month-day">{Number(event.eventDate.slice(5, 7))}/{Number(event.eventDate.slice(8, 10))}</span>
                    </time>
                    <span id={`event-description-${event.id}`} className="event-row-description">{event.eventDate} {timeRangeLabel(event)} {RECURRENCE_LABELS[event.recurrenceType]}</span>
                  </span>
                  <span className="event-row-content">
                    <span className="event-row-title">{event.name}</span>
                    <span className="event-row-meta"><span>{timeRangeLabel(event)}</span><span>{RECURRENCE_LABELS[event.recurrenceType]}</span></span>
                  </span>
                </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {detailEvent && modalTarget === undefined && (
        <EventDetailModal
          event={detailEvent}
          onClose={closeDetail}
        />
      )}
      {modalTarget !== undefined && (
        <EventModal event={modalTarget} onClose={() => { setModalTarget(undefined); if (detailId === null) requestAnimationFrame(restoreFocus) }} onSaved={handleSaved}
          onDeleted={modalTarget?.editable ? () => {
            // 削除が確定した行はcommit前にまだ接続されていても復帰先にしない。
            detailTrigger.current = null
            setEvents(previous => previous.filter(event => event.id !== modalTarget.id))
            setModalTarget(undefined)
            requestAnimationFrame(restoreFocus)
            showToast('イベントを削除しました')
          } : undefined} />
      )}
      <Toast message={toast.message} showKey={toast.showKey} />
    </div>
  )
}

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
  const [modalTarget, setModalTarget] = useState<Event | null | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<Event | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const detailTrigger = useRef<HTMLButtonElement | null>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const restoreFocus = useCallback(() => {
    (detailTrigger.current?.isConnected ? detailTrigger.current : addButton.current)?.focus({ preventScroll: true })
  }, [])
  const closeDetail = useCallback(() => { setDetailId(null); restoreFocus() }, [restoreFocus])
  const [toggling, setToggling] = useState(false)
  const [toast, setToast] = useState({ message: '', showKey: 0 })

  const showToast = useCallback((message: string) => {
    setToast((prev) => ({ message, showKey: prev.showKey + 1 }))
  }, [])

  const fetchEvents = useCallback(async () => {
    const response = await apiClient.get<Event[]>('/events')
    setEvents(response.data)
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

  const handleToggleShowOnDashboard = async (event: Event) => {
    if (toggling || !event.editable) return
    setToggling(true)
    const nextShowOnDashboard = !event.showOnDashboard
    try {
      await apiClient.patch(`/events/${event.id}/show-on-dashboard`, { showOnDashboard: nextShowOnDashboard })
    } catch (err) {
      showToast(getApiErrorMessage(err, '表示設定の更新に失敗しました'))
      setToggling(false)
      return
    }
    setEvents((prev) => prev.map((e) => e.id === event.id ? { ...e, showOnDashboard: nextShowOnDashboard } : e))
    setToggling(false)
  }

  const handleDelete = async () => {
    if (!deleteTarget || deleting || !deleteTarget.editable) return
    const deletedId = deleteTarget.id
    setDeleting(true)
    try {
      await apiClient.delete(`/events/${deletedId}`)
    } catch (err) {
      showToast(getApiErrorMessage(err, 'イベントの削除に失敗しました'))
      setDeleting(false)
      setDeleteTarget(null)
      return
    }
    setEvents((prev) => prev.filter((event) => event.id !== deletedId))
    setDeleting(false)
    setDeleteTarget(null)
    setDetailId(null)
    requestAnimationFrame(restoreFocus)
    showToast('イベントを削除しました')
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
          <button ref={addButton} type="button" className="btn btn-primary" onClick={() => setModalTarget(null)}>
            イベントを登録
          </button>
        </div>
        <div className="events-list">
          <div className="list-row-heading events-grid"><span>イベント名</span><span>日時</span><span>繰り返し</span></div>
            {events.length === 0 ? (
              <p>イベントはありません</p>
            ) : (
              events.map((event) => (
                <button key={event.id} type="button" className="list-row-button events-grid" aria-label={`${event.name}の詳細`}
                  onClick={(clickEvent) => { detailTrigger.current = clickEvent.currentTarget; setDetailId(event.id) }}>
                  <span>{event.name}</span>
                  <span>{event.eventDate}（{timeRangeLabel(event)}）</span>
                  <span>{RECURRENCE_LABELS[event.recurrenceType]}</span>
                </button>
              ))
            )}
        </div>
      </div>
      {detailEvent && modalTarget === undefined && !deleteTarget && (
        <EventDetailModal
          event={detailEvent}
          onClose={closeDetail}
          onEdit={() => setModalTarget(detailEvent)}
          onDelete={() => setDeleteTarget(detailEvent)}
          onToggle={handleToggleShowOnDashboard}
          toggling={toggling}
        />
      )}
      {modalTarget !== undefined && (
        <EventModal event={modalTarget} onClose={() => setModalTarget(undefined)} onSaved={handleSaved} />
      )}
      {deleteTarget && (
        <div className="modal-overlay">
          <div className="modal event-modal">
            <h2>イベントを削除しますか？</h2>
            <p className="hint">「{deleteTarget.name}」を削除します。この操作は取り消せません。</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={handleDelete} disabled={deleting}>
                削除する
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
      <Toast message={toast.message} showKey={toast.showKey} />
    </div>
  )
}

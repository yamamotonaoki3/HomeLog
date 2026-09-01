import { useCallback, useEffect, useRef, useState } from 'react'
import { isAxiosError } from 'axios'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { Event, SummaryPeriod } from '../api/eventTypes'
import { Toast } from '../components/Toast'
import { EventModal } from '../components/events/EventModal'

const RECURRENCE_LABELS: Record<Event['recurrenceType'], string> = {
  none: '単発',
  daily: '毎日',
  weekly: '毎週',
  monthly: '毎月',
  yearly: '毎年',
}

// イベント1件分の集計状態。show_on_dashboard=falseによる404(意図した集計対象外)と、
// 通信断・認証切れ・サーバーエラー等の予期しない失敗を区別して表示を出し分ける。
type SummaryState = { status: 'ok'; total: number } | { status: 'excluded' } | { status: 'error' }

export function EventsPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [modalTarget, setModalTarget] = useState<Event | null | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<Event | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [period, setPeriod] = useState<SummaryPeriod>('year')
  const [summaries, setSummaries] = useState<Record<number, SummaryState>>({})
  const [toast, setToast] = useState({ message: '', showKey: 0 })

  const showToast = useCallback((message: string) => {
    setToast((prev) => ({ message, showKey: prev.showKey + 1 }))
  }, [])

  const fetchEvents = useCallback(async () => {
    const response = await apiClient.get<Event[]>('/events')
    setEvents(response.data)
    return response.data
  }, [])

  // 直近でリクエストした集計取得の通し番号(リクエストID)を覚えておくためのref。
  // 対象期間(今年/今月)を素早く切り替えた場合、後から投げたリクエストのレスポンスより
  // 先に前のリクエストのレスポンスが返ってくる(順序が逆転する)ことがあり、対策しないと
  // 古い期間の集計結果で新しい期間の画面を上書きしてしまう(MenuPage.tsxで確立した
  // パターンと同じ)。
  const summaryRequestIdRef = useRef(0)

  const fetchSummaries = useCallback(
    async (targetEvents: Event[], targetPeriod: SummaryPeriod) => {
      const requestId = ++summaryRequestIdRef.current
      let hadUnexpectedError = false
      const entries = await Promise.all(
        targetEvents.map(async (event) => {
          try {
            const response = await apiClient.get<{ total: number }>(`/events/${event.id}/summary`, {
              params: { period: targetPeriod },
            })
            return [event.id, { status: 'ok', total: response.data.total } as SummaryState] as const
          } catch (err) {
            // show_on_dashboard=falseのイベントは404になる(集計対象外の意図した結果)。
            // それ以外のエラー(通信断・認証切れ・サーバーエラー等)は集計対象外と区別し、
            // 「取得に失敗しました」の表示にする(誤って「集計対象外」と見せない)。
            if (isAxiosError(err) && err.response?.status === 404) {
              return [event.id, { status: 'excluded' } as SummaryState] as const
            }
            hadUnexpectedError = true
            return [event.id, { status: 'error' } as SummaryState] as const
          }
        }),
      )
      if (summaryRequestIdRef.current !== requestId) {
        // このリクエストを投げた後に、さらに新しい対象期間への切り替えが発生していた場合、
        // この結果は古いので画面に反映しない。
        return
      }
      setSummaries(Object.fromEntries(entries))
      if (hadUnexpectedError) {
        showToast('一部のイベントの集計取得に失敗しました。時間をおいて再度お試しください')
      }
    },
    [showToast],
  )

  useEffect(() => {
    let cancelled = false
    fetchEvents()
      .then((fetchedEvents) => {
        if (cancelled) return
        return fetchSummaries(fetchedEvents, period)
      })
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
  }, [fetchEvents, fetchSummaries, period, showToast])

  const handleSaved = async () => {
    const wasEdit = modalTarget != null
    let fetchedEvents: Event[]
    try {
      fetchedEvents = await fetchEvents()
    } catch (err) {
      showToast(getApiErrorMessage(err, 'イベント一覧の取得に失敗しました'))
      throw err
    }
    await fetchSummaries(fetchedEvents, period)
    setModalTarget(undefined)
    showToast(wasEdit ? 'イベントを更新しました' : 'イベントを登録しました')
  }

  const handleToggleShowOnDashboard = async (event: Event) => {
    const nextShowOnDashboard = !event.showOnDashboard
    try {
      await apiClient.patch(`/events/${event.id}/show-on-dashboard`, { showOnDashboard: nextShowOnDashboard })
    } catch (err) {
      showToast(getApiErrorMessage(err, '表示設定の更新に失敗しました'))
      return
    }
    setEvents((prev) => prev.map((e) => (e.id === event.id ? { ...e, showOnDashboard: nextShowOnDashboard } : e)))
    if (!nextShowOnDashboard) {
      setSummaries((prev) => ({ ...prev, [event.id]: { status: 'excluded' } }))
    } else {
      try {
        const response = await apiClient.get<{ total: number }>(`/events/${event.id}/summary`, { params: { period } })
        setSummaries((prev) => ({ ...prev, [event.id]: { status: 'ok', total: response.data.total } }))
      } catch (err) {
        // 表示設定自体の切り替えは成功しているため、集計取得の失敗はトーストで知らせるに留める。
        setSummaries((prev) => ({ ...prev, [event.id]: { status: 'error' } }))
        showToast(getApiErrorMessage(err, '集計の取得に失敗しました'))
      }
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
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
    showToast('イベントを削除しました')
  }

  if (loading) {
    return <p>読み込み中...</p>
  }

  return (
    <div className="page">
      <div className="panel" data-testid="events-panel">
        <div className="toolbar">
          <h2>イベント一覧</h2>
          <button type="button" className="btn btn-primary" onClick={() => setModalTarget(null)}>
            イベントを登録
          </button>
          <label htmlFor="events-period">集計対象期間</label>
          <select id="events-period" value={period} onChange={(e) => setPeriod(e.target.value as SummaryPeriod)}>
            <option value="year">今年</option>
            <option value="month">今月</option>
          </select>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>イベント名</th>
              <th>日付</th>
              <th>繰り返し</th>
              <th>公開範囲</th>
              <th>ダッシュボード表示</th>
              <th>集計金額</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={7}>イベントはありません</td>
              </tr>
            ) : (
              events.map((event) => {
                const summary = summaries[event.id]
                return (
                  <tr key={event.id}>
                    <td>{event.name}</td>
                    <td>{event.eventDate}</td>
                    <td>{RECURRENCE_LABELS[event.recurrenceType]}</td>
                    <td>{event.personal ? '個人' : '世帯共有'}</td>
                    <td>
                      {event.editable ? (
                        <button
                          type="button"
                          className="btn btn-tiny"
                          onClick={() => handleToggleShowOnDashboard(event)}
                          aria-pressed={event.showOnDashboard}
                        >
                          {event.showOnDashboard ? '表示する' : '表示しない'}
                        </button>
                      ) : (
                        // 登録者以外はshow_on_dashboardをバックエンドで変更できないため
                        // (PATCH /api/events/:id/show-on-dashboardはcreated_by_user_id本人のみ許可)、
                        // 現在の状態を読み取り専用で表示する。
                        <span>{event.showOnDashboard ? '表示する' : '表示しない'}</span>
                      )}
                    </td>
                    <td>
                      {summary?.status === 'ok' ? `${summary.total}円` : summary?.status === 'error' ? '取得失敗' : '集計対象外'}
                    </td>
                    <td>
                      {event.editable && (
                        <>
                          <button type="button" className="btn btn-tiny" onClick={() => setModalTarget(event)}>
                            編集
                          </button>
                          <button type="button" className="btn btn-tiny" onClick={() => setDeleteTarget(event)}>
                            削除
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {modalTarget !== undefined && (
        <EventModal event={modalTarget} onClose={() => setModalTarget(undefined)} onSaved={handleSaved} />
      )}
      {deleteTarget && (
        <div className="modal-overlay">
          <div className="modal">
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

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import { useDialog } from '../../hooks/useDialog'
import { EventSummary } from './EventSummary'
import type { Event } from '../../api/eventTypes'

interface Props {
  event: Event | null
  onClose: () => void
  onSaved: () => Promise<void>
  onDeleted?: () => void
}

const RECURRENCE_OPTIONS: { value: Event['recurrenceType']; label: string }[] = [
  { value: 'none', label: '単発' },
  { value: 'daily', label: '毎日' },
  { value: 'weekly', label: '毎週' },
  { value: 'monthly', label: '毎月' },
  { value: 'yearly', label: '毎年' },
]

export function EventModal({ event, onClose, onSaved, onDeleted }: Props) {
  const isEdit = event !== null
  const [name, setName] = useState(event?.name ?? '')
  const [eventDate, setEventDate] = useState(event?.eventDate ?? '')
  const [isAllDay, setIsAllDay] = useState(event?.isAllDay ?? true)
  const [startTime, setStartTime] = useState(event?.startTime ?? '')
  const [endTime, setEndTime] = useState(event?.endTime ?? '')
  const [recurrenceType, setRecurrenceType] = useState<Event['recurrenceType']>(event?.recurrenceType ?? 'none')
  const [notifyEnabled, setNotifyEnabled] = useState(event?.recurrenceType !== 'none' && (event?.notifyEnabled ?? false))
  const [defaultAmount, setDefaultAmount] = useState(event?.defaultAmount != null ? String(event.defaultAmount) : '')
  const [showOnDashboard, setShowOnDashboard] = useState(event?.showOnDashboard ?? true)
  const [personal, setPersonal] = useState(event?.personal ?? false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [otherOpen, setOtherOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const returnToDelete = useRef(false)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const cancelDeleteButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (confirmDelete) cancelDeleteButton.current?.focus()
    else if (returnToDelete.current) {
      returnToDelete.current = false
      deleteButton.current?.focus()
    }
  }, [confirmDelete])
  const pending = useRef(false)
  const close = () => { if (!pending.current) onClose() }
  const dialogRef = useDialog(close, '#event-name')

  const handleDelete = async () => {
    if (!event?.editable || pending.current || !onDeleted) return
    pending.current = true
    setSubmitting(true)
    setError('')
    try {
      await apiClient.delete(`/events/${event.id}`)
    } catch (err) {
      setError(getApiErrorMessage(err, 'イベントの削除に失敗しました'))
      pending.current = false
      setSubmitting(false)
      return
    }
    onDeleted()
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (pending.current || confirmDelete) return
    const trimmedName = name.trim()
    if (trimmedName.length < 1 || trimmedName.length > 50) {
      setError('イベント名は1〜50文字で入力してください')
      return
    }
    if (eventDate === '') {
      setError('日付を入力してください')
      return
    }
    if (!isAllDay && startTime === '') {
      setError('終日でない場合は開始時刻を入力してください')
      return
    }
    if (!isAllDay && endTime !== '' && endTime < startTime) {
      setError('終了時刻は開始時刻より後にしてください')
      return
    }
    const defaultAmountValue = defaultAmount.trim() === '' ? null : Number(defaultAmount)
    if (defaultAmountValue !== null && (!Number.isInteger(defaultAmountValue) || defaultAmountValue <= 0)) {
      setError('デフォルト金額は1以上の整数で入力してください')
      return
    }

    setError('')
    pending.current = true
    setSubmitting(true)
    const payload = {
      name: trimmedName,
      eventDate,
      isAllDay,
      startTime: isAllDay ? null : startTime,
      endTime: isAllDay || endTime === '' ? null : endTime,
      recurrenceType,
      notifyEnabled: recurrenceType !== 'none' && notifyEnabled,
      defaultAmount: defaultAmountValue,
      showOnDashboard,
      personal,
    }
    try {
      if (isEdit) {
        await apiClient.patch(`/events/${event.id}`, payload)
      } else {
        await apiClient.post('/events', payload)
      }
    } catch (err) {
      setError(getApiErrorMessage(err, isEdit ? 'イベントの更新に失敗しました' : 'イベントの登録に失敗しました'))
      pending.current = false
      setSubmitting(false)
      return
    }

    try {
      await onSaved()
    } catch {
      // The caller is responsible for notifying the user about refresh failures.
    } finally {
      onClose()
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) close() }}>
      <div ref={dialogRef} className="modal event-modal event-editor" role="dialog" aria-modal="true" aria-label={isEdit ? 'イベントを編集' : 'イベントを登録'}>
        <div className="event-editor-header">
          <h2>{isEdit ? 'イベントを編集' : 'イベントを登録'}</h2>
          {event?.editable && onDeleted && <button ref={deleteButton} type="button" className="event-editor-trash" aria-label={event.name + 'を削除'} title={event.name + 'を削除'} disabled={submitting || confirmDelete} onClick={() => { setError(''); setConfirmDelete(true) }}>
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg>
          </button>}
        </div>
        <form className="event-editor-form" onSubmit={handleSubmit} noValidate>
          <div className="event-editor-body">
            <fieldset className="event-editor-fields" disabled={submitting || confirmDelete}>
              <label htmlFor="event-name">イベント名</label>
              <input id="event-name" type="text" maxLength={50} value={name} onChange={(e) => setName(e.target.value)} />
              <label htmlFor="event-date">日付</label>
              <input id="event-date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
              <label htmlFor="event-all-day">
                <input
                  id="event-all-day"
                  type="checkbox"
                  checked={isAllDay}
                  onChange={(e) => setIsAllDay(e.target.checked)}
                />
                終日
              </label>
              {!isAllDay && (
                <div className="event-time-inputs">
                  <div><label htmlFor="event-start-time">開始時刻</label>
                  <input id="event-start-time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
                  <div><label htmlFor="event-end-time">終了時刻（任意）</label>
                  <input id="event-end-time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
                </div>
              )}
              <label htmlFor="event-recurrence">繰り返し</label>
              <select
                id="event-recurrence"
                value={recurrenceType}
                onChange={(e) => {
                  const next = e.target.value as Event['recurrenceType']
                  setRecurrenceType(next)
                  if (next === 'none') setNotifyEnabled(false)
                }}
              >
                {RECURRENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <label htmlFor="event-notify">
                <input
                  id="event-notify"
                  type="checkbox"
                  checked={recurrenceType !== 'none' && notifyEnabled}
                  disabled={recurrenceType === 'none'}
                  aria-describedby={recurrenceType === 'none' ? 'event-notify-reason' : undefined}
                  onChange={(e) => setNotifyEnabled(e.target.checked)}
                />
                通知する
              </label>
              {recurrenceType === 'none' && <p id="event-notify-reason" className="event-notify-reason">単発イベントは通知対象外です</p>}
              <fieldset className="event-visibility">
                <legend>公開範囲</legend>
                <label><input type="radio" name="event-personal" checked={!personal} onChange={() => setPersonal(false)} />世帯共有</label>
                <label><input type="radio" name="event-personal" checked={personal} onChange={() => setPersonal(true)} />個人</label>
              </fieldset>
              <button type="button" className="event-other-toggle" aria-expanded={otherOpen} aria-controls="event-other-settings" onClick={() => setOtherOpen(!otherOpen)}>
                その他の設定 <span>{defaultAmount.trim() === '' ? '金額未設定' : Number(defaultAmount).toLocaleString('ja-JP') + '円'}・サマリー{showOnDashboard ? '表示' : '非表示'}</span>
              </button>
              <div id="event-other-settings" className="event-other-settings" hidden={!otherOpen}>
              <label htmlFor="event-default-amount">デフォルト金額（任意）</label>
              <input
                id="event-default-amount"
                type="number"
                step="1"
                value={defaultAmount}
                onChange={(e) => setDefaultAmount(e.target.value)}
              />
              <label htmlFor="event-show-on-dashboard">
                <input
                  id="event-show-on-dashboard"
                  type="checkbox"
                  checked={showOnDashboard}
                  onChange={(e) => setShowOnDashboard(e.target.checked)}
                />
                トップ画面のイベント別支出サマリーに表示する
              </label>
            </div>
            </fieldset>
            {event && <EventSummary event={event} />}
          {error && <p className="error" role="alert">{error}</p>}
          {confirmDelete && <section className="event-delete-confirm" aria-label="削除確認">
            <p>「{event?.name}」を削除しますか？この操作は取り消せません。</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-danger" disabled={submitting} onClick={handleDelete}>削除する</button>
              <button ref={cancelDeleteButton} type="button" className="btn btn-secondary" disabled={submitting} onClick={() => { returnToDelete.current = true; setConfirmDelete(false); setError('') }}>削除をやめる</button>
            </div>
          </section>}
          </div>
          <div className="modal-actions ui-form-actions event-editor-actions">
            <button type="button" className="ui-form-cancel" onClick={close} disabled={submitting}>
              キャンセル
            </button>
            <button type="submit" className="ui-action" disabled={submitting || confirmDelete}>
              {isEdit ? '更新' : '登録'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { Event } from '../../api/eventTypes'

interface Props {
  event: Event | null
  onClose: () => void
  onSaved: () => Promise<void>
}

const RECURRENCE_OPTIONS: { value: Event['recurrenceType']; label: string }[] = [
  { value: 'none', label: '単発' },
  { value: 'daily', label: '毎日' },
  { value: 'weekly', label: '毎週' },
  { value: 'monthly', label: '毎月' },
  { value: 'yearly', label: '毎年' },
]

export function EventModal({ event, onClose, onSaved }: Props) {
  const isEdit = event !== null
  const [name, setName] = useState(event?.name ?? '')
  const [eventDate, setEventDate] = useState(event?.eventDate ?? '')
  const [isAllDay, setIsAllDay] = useState(event?.isAllDay ?? true)
  const [startTime, setStartTime] = useState(event?.startTime ?? '')
  const [endTime, setEndTime] = useState(event?.endTime ?? '')
  const [recurrenceType, setRecurrenceType] = useState<Event['recurrenceType']>(event?.recurrenceType ?? 'none')
  const [notifyEnabled, setNotifyEnabled] = useState(event?.notifyEnabled ?? false)
  const [defaultAmount, setDefaultAmount] = useState(event?.defaultAmount != null ? String(event.defaultAmount) : '')
  const [personal, setPersonal] = useState(event?.personal ?? false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
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
    setSubmitting(true)
    const payload = {
      name: trimmedName,
      eventDate,
      isAllDay,
      startTime: isAllDay ? null : startTime,
      endTime: isAllDay || endTime === '' ? null : endTime,
      recurrenceType,
      notifyEnabled,
      defaultAmount: defaultAmountValue,
      showOnDashboard: event?.showOnDashboard ?? true,
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
    <div className="modal-overlay">
      <div className="modal">
        <h2>{isEdit ? 'イベントを編集' : 'イベントを登録'}</h2>
        <form onSubmit={handleSubmit} noValidate>
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
            <>
              <label htmlFor="event-start-time">開始時刻</label>
              <input id="event-start-time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              <label htmlFor="event-end-time">終了時刻（任意）</label>
              <input id="event-end-time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </>
          )}
          <label htmlFor="event-recurrence">繰り返し</label>
          <select
            id="event-recurrence"
            value={recurrenceType}
            onChange={(e) => setRecurrenceType(e.target.value as Event['recurrenceType'])}
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
              checked={notifyEnabled}
              onChange={(e) => setNotifyEnabled(e.target.checked)}
            />
            通知する
          </label>
          <label htmlFor="event-default-amount">デフォルト金額（任意）</label>
          <input
            id="event-default-amount"
            type="number"
            step="1"
            value={defaultAmount}
            onChange={(e) => setDefaultAmount(e.target.value)}
          />
          <fieldset>
            <legend>公開範囲</legend>
            <label>
              <input type="radio" name="event-personal" checked={!personal} onChange={() => setPersonal(false)} />
              世帯共有
            </label>
            <label>
              <input type="radio" name="event-personal" checked={personal} onChange={() => setPersonal(true)} />
              個人
            </label>
          </fieldset>
          <p className="error">{error}</p>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {isEdit ? '更新' : '登録'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              キャンセル
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

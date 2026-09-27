import { useEffect, useState } from 'react'
import { apiClient } from '../api/client'

interface NotificationResponse {
  notificationCount: number
}

type NotificationState = 'loading' | 'success' | 'error'

export function NotificationAlarm() {
  const [state, setState] = useState<NotificationState>('loading')
  const [notificationCount, setNotificationCount] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    apiClient.get<NotificationResponse>('/dashboard/notifications/today', { signal: controller.signal }).then((response) => {
      if (!active || controller.signal.aborted) return
      setNotificationCount(Math.max(0, response.data.notificationCount))
      setState('success')
    }).catch(() => {
      if (!active || controller.signal.aborted) return
      setState('error')
    })

    return () => {
      active = false
      controller.abort()
    }
  }, [])

  const label = state === 'loading'
    ? '通知アラームを読み込み中'
    : state === 'error'
      ? '通知アラーム（通知を取得できません）'
      : `通知アラーム（${notificationCount}件）`

  return (
    <span className={`notification-alarm notification-alarm-${state}`} role="img" aria-label={label} title={label}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </svg>
      <span aria-hidden="true" className="notification-alarm-count">{state === 'error' ? '—' : state === 'loading' ? '…' : notificationCount}</span>
    </span>
  )
}

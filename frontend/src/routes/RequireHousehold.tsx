import { isAxiosError } from 'axios'
import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { apiClient } from '../api/client'

type Status = 'loading' | 'has-household' | 'no-household' | 'error'

export function RequireHousehold() {
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    let cancelled = false

    apiClient
      .get('/households/me')
      .then(() => {
        if (!cancelled) {
          setStatus('has-household')
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }
        if (isAxiosError(error) && error.response?.status === 404) {
          setStatus('no-household')
        } else {
          setStatus('error')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (status === 'loading') {
    return <p>読み込み中...</p>
  }

  if (status === 'no-household') {
    return <Navigate to="/household" replace />
  }

  if (status === 'error') {
    return <p>世帯グループ情報の取得に失敗しました。時間をおいて再度お試しください。</p>
  }

  return <Outlet />
}

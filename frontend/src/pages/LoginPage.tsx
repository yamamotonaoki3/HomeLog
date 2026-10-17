import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { useAuth } from '../context/useAuth'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import { PasswordField } from '../components/PasswordField'
import { formatDeletionDate } from '../lib/accountDeletion'

interface LocationState {
  from?: string
  // 退会を申し込んだ直後にアカウント設定から渡される削除予定日(#298)。
  deletionScheduledAt?: string
}

interface ErrorBody {
  code?: string
  details?: { field: string; reason: string }[]
}

// 退会の取り消し期間中は、ログインに403 ACCOUNT_DELETION_PENDINGと削除予定日が返る(F01_auth.md 8-2章)。
function pendingDeletionDate(error: unknown): string | null {
  if (!isAxiosError<ErrorBody>(error) || error.response?.status !== 403) return null
  const body = error.response.data
  if (body?.code !== 'ACCOUNT_DELETION_PENDING') return null
  return body.details?.find((detail) => detail.field === 'deletionScheduledAt')?.reason ?? null
}

export function LoginPage() {
  const { login, cancelDeletion } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as LocationState | null
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [pendingUntil, setPendingUntil] = useState<string | null>(null)

  const goNext = () => navigate(state?.from ?? '/', { replace: true })

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setPendingUntil(null)
    setSubmitting(true)
    try {
      await login(email.trim(), password)
      goNext()
    } catch (err) {
      const scheduledAt = pendingDeletionDate(err)
      if (scheduledAt) {
        setPendingUntil(scheduledAt)
      } else if (isAxiosError(err) && err.response?.status === 401) {
        setError('メールアドレスまたはパスワードが違います')
      } else {
        setError(getApiErrorMessage(err, 'ログインに失敗しました。時間をおいて再度お試しください'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancelDeletion = async () => {
    setError('')
    setSubmitting(true)
    try {
      await cancelDeletion(email.trim(), password)
      goNext()
    } catch (err) {
      setPendingUntil(null)
      setError(getApiErrorMessage(err, '退会の取り消しに失敗しました。もう一度ログインしてください'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="center-screen">
      <div className="auth-card">
        <h1 className="logo-title">HomeLog</h1>
        {state?.deletionScheduledAt && !pendingUntil && (
          <p className="auth-notice" role="status">
            退会を申し込みました。{formatDeletionDate(state.deletionScheduledAt)}までにログインすると取り消せます。
          </p>
        )}
        {pendingUntil ? (
          <section className="deletion-pending" aria-labelledby="deletion-pending-heading">
            <h2 id="deletion-pending-heading">退会手続き中です</h2>
            <p>このアカウントは {formatDeletionDate(pendingUntil)} に削除されます。退会を取り消すと、これまでどおり使えます。</p>
            <button type="button" className="btn btn-primary btn-block" disabled={submitting} onClick={() => void handleCancelDeletion()}>
              退会を取り消してログイン
            </button>
            <button type="button" className="btn btn-secondary btn-block" disabled={submitting} onClick={() => setPendingUntil(null)}>
              取り消さない
            </button>
          </section>
        ) : (
          <form onSubmit={handleSubmit}>
            <label htmlFor="login-email">メールアドレス</label>
            <input
              id="login-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <PasswordField
              id="login-password"
              label="パスワード"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />
            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              ログイン
            </button>
          </form>
        )}
        <p className="error">{error}</p>
        <div className="auth-links">
          <Link to="/password-reset">パスワードを忘れた場合</Link>
          <Link to="/register">新規登録はこちら</Link>
        </div>
      </div>
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { useAuth } from '../context/useAuth'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import { PasswordField } from '../components/PasswordField'

interface LocationState {
  from?: { pathname?: string }
}

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await login(email.trim(), password)
      const from = (location.state as LocationState | null)?.from?.pathname
      navigate(from ?? '/', { replace: true })
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 401) {
        setError('メールアドレスまたはパスワードが違います')
      } else {
        setError(getApiErrorMessage(err, 'ログインに失敗しました。時間をおいて再度お試しください'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="center-screen">
      <div className="auth-card">
        <h1 className="logo-title">HomeLog</h1>
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
        <p className="error">{error}</p>
        <div className="auth-links">
          <Link to="/password-reset">パスワードを忘れた場合</Link>
          <Link to="/register">新規登録はこちら</Link>
        </div>
      </div>
    </div>
  )
}

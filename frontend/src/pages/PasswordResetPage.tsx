import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import { PasswordField } from '../components/PasswordField'

const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/

interface RequestResponse {
  message: string
}

export function PasswordResetPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [step, setStep] = useState<1 | 2>(1)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleRequest = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const response = await apiClient.post<RequestResponse>('/auth/password-reset/request', {
        email: email.trim(),
      })
      setMessage(response.data.message)
      setStep(2)
    } catch (err) {
      setError(getApiErrorMessage(err, '申請に失敗しました。時間をおいて再度お試しください'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleConfirm = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (!PASSWORD_PATTERN.test(newPassword)) {
      setError('パスワードは8文字以上、英字と数字を含めてください')
      return
    }
    if (newPassword !== newPasswordConfirm) {
      setError('パスワードが一致しません')
      return
    }

    setSubmitting(true)
    try {
      await apiClient.post('/auth/password-reset/confirm', {
        token: token.trim(),
        newPassword,
      })
      navigate('/login', { replace: true })
    } catch (err) {
      setError(getApiErrorMessage(err, 'パスワードの変更に失敗しました。時間をおいて再度お試しください'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="center-screen">
      <div className="auth-card">
        <h1>パスワードリセット</h1>
        {step === 1 ? (
          <form onSubmit={handleRequest}>
            <label htmlFor="reset-email">メールアドレス</label>
            <input
              id="reset-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              送信する
            </button>
          </form>
        ) : (
          <form onSubmit={handleConfirm}>
            <p className="hint">メールに記載されたリセットトークンを入力してください</p>
            <label htmlFor="reset-token">リセットトークン</label>
            <input
              id="reset-token"
              type="text"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <PasswordField
              id="reset-new-password"
              label="新しいパスワード（8文字以上、英字と数字を含む）"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
            />
            <PasswordField
              id="reset-new-password-confirm"
              label="新しいパスワード（確認）"
              value={newPasswordConfirm}
              onChange={setNewPasswordConfirm}
              autoComplete="new-password"
            />
            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              変更する
            </button>
          </form>
        )}
        <p className="success">{message}</p>
        <p className="error">{error}</p>
        <div className="auth-links">
          <Link to="/login">ログイン画面へ戻る</Link>
        </div>
      </div>
    </div>
  )
}

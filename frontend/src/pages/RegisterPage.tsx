import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import { useAuth } from '../context/useAuth'

const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/

export function RegisterPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (!PASSWORD_PATTERN.test(password)) {
      setError('パスワードは8文字以上、英字と数字を含めてください')
      return
    }
    const trimmedName = displayName.trim()
    if (trimmedName.length < 1 || trimmedName.length > 50) {
      setError('表示名は1〜50文字で入力してください')
      return
    }

    setSubmitting(true)
    try {
      await apiClient.post('/auth/register', {
        email: email.trim(),
        password,
        displayName: trimmedName,
      })
      await login(email.trim(), password)
      navigate('/household', { replace: true })
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 409) {
        setError('このメールアドレスは既に登録されています')
      } else {
        setError(getApiErrorMessage(err, '登録に失敗しました。時間をおいて再度お試しください'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="center-screen">
      <div className="auth-card">
        <h1>新規登録</h1>
        <form onSubmit={handleSubmit}>
          <label htmlFor="reg-email">メールアドレス</label>
          <input
            id="reg-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label htmlFor="reg-password">パスワード（8文字以上、英字と数字を含む）</label>
          <input
            id="reg-password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <label htmlFor="reg-name">表示名</label>
          <input
            id="reg-name"
            type="text"
            required
            maxLength={50}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            登録する
          </button>
        </form>
        <p className="error">{error}</p>
        <div className="auth-links">
          <Link to="/login">ログインはこちら</Link>
        </div>
      </div>
    </div>
  )
}

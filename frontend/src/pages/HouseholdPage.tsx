import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'

export function HouseholdPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await apiClient.post('/households', { name: name.trim() })
      navigate('/', { replace: true })
    } catch (err) {
      setError(getApiErrorMessage(err, '世帯グループの作成に失敗しました。時間をおいて再度お試しください'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleJoin = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await apiClient.post('/households/join', { inviteCode: inviteCode.trim() })
      navigate('/', { replace: true })
    } catch (err) {
      setError(getApiErrorMessage(err, '世帯グループへの参加に失敗しました。時間をおいて再度お試しください'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="center-screen">
      <div className="auth-card auth-card-wide">
        <h1>世帯グループ</h1>
        <div className="split-two">
          <form onSubmit={handleCreate}>
            <h2>新規作成</h2>
            <label htmlFor="hh-name">世帯グループ名</label>
            <input
              id="hh-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              作成する
            </button>
          </form>
          <form onSubmit={handleJoin}>
            <h2>既存に参加</h2>
            <label htmlFor="hh-code">招待コード</label>
            <input
              id="hh-code"
              type="text"
              required
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
            />
            <button type="submit" className="btn btn-secondary btn-block" disabled={submitting}>
              参加する
            </button>
          </form>
        </div>
        <p className="error">{error}</p>
      </div>
    </div>
  )
}

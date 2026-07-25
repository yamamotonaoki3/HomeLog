import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'

interface Member {
  userId: number
  displayName: string
}

interface HouseholdMe {
  id: number
  name: string
  inviteCode: string
  members: Member[]
}

export function HouseholdSettingsPage() {
  const navigate = useNavigate()
  const [household, setHousehold] = useState<HouseholdMe | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiClient
      .get<HouseholdMe>('/households/me')
      .then((response) => {
        if (!cancelled) {
          setHousehold(response.data)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(getApiErrorMessage(err, '世帯グループ情報の取得に失敗しました'))
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleLeave = async () => {
    setError('')
    setSubmitting(true)
    try {
      await apiClient.post('/households/leave')
      navigate('/household', { replace: true })
    } catch (err) {
      setError(getApiErrorMessage(err, '世帯グループからの退出に失敗しました'))
      setSubmitting(false)
      setConfirmOpen(false)
    }
  }

  if (!household) {
    return <p>{error || '読み込み中...'}</p>
  }

  return (
    <div className="page">
      <div className="panel">
        <h2>世帯設定</h2>
        <p>
          世帯グループ名：<strong>{household.name}</strong>
        </p>
        <p>
          招待コード：<strong>{household.inviteCode}</strong>
        </p>
        <h3>メンバー</h3>
        <ul>
          {household.members.map((member) => (
            <li key={member.userId}>{member.displayName}</li>
          ))}
        </ul>
        <p className="error">{error}</p>
        <button type="button" className="btn btn-secondary" onClick={() => setConfirmOpen(true)}>
          世帯グループから退出する
        </button>
      </div>
      {confirmOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>本当に退出しますか？</h2>
            <p className="hint">
              退出すると世帯グループの共有データにアクセスできなくなります。あなたが最後のメンバーの場合、世帯グループと共有データ（在庫・買い物リスト等）はすべて削除されます。
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={handleLeave} disabled={submitting}>
                退出する
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmOpen(false)}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

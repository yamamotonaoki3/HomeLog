import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import { UiIcon } from '../components/UiIcon'
import { useDialog } from '../hooks/useDialog'

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

// 世帯設定(S-27)。世帯グループの情報を確認する画面で、変更できるのは退出だけ。
// 退出は取り消せない影響があるので、通常の情報から離して下部に分ける(#501)。
export function HouseholdSettingsPage() {
  const navigate = useNavigate()
  const [household, setHousehold] = useState<HouseholdMe | null>(null)
  const [loadError, setLoadError] = useState('')
  const [copyResult, setCopyResult] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [leaveError, setLeaveError] = useState('')
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
          setLoadError(getApiErrorMessage(err, '世帯グループ情報の取得に失敗しました'))
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const copyInviteCode = async () => {
    if (!household) return
    try {
      // 暗号化されていない接続などでは clipboard が使えない。その場合も下の案内へ進む。
      await navigator.clipboard.writeText(household.inviteCode)
      setCopyResult('招待コードをコピーしました')
    } catch {
      setCopyResult('コピーできませんでした。招待コードを選択してコピーしてください')
    }
  }

  const handleLeave = async () => {
    if (submitting) return
    setLeaveError('')
    setSubmitting(true)
    try {
      await apiClient.post('/households/leave')
      navigate('/household', { replace: true })
    } catch (err) {
      setLeaveError(getApiErrorMessage(err, '世帯グループからの退出に失敗しました'))
      setSubmitting(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div className="page household-settings-page">
      <div className="ui-narrow" data-testid="household-settings-panel">
        <Link to="/settings" className="ui-back-link">
          <span aria-hidden="true">‹</span>設定に戻る
        </Link>
        <header className="ui-page-head">
          <div>
            <h2>世帯設定</h2>
            <p className="ui-page-sub">世帯グループの情報とメンバーを確認できます</p>
          </div>
        </header>
        {loadError ? (
          <p role="alert" className="error">{loadError}</p>
        ) : !household ? (
          <p role="status">読み込み中...</p>
        ) : (
          <>
            <section className="ui-card household-info" aria-label="世帯グループの情報">
              <div className="household-fact">
                <UiIcon name="household" />
                <dl className="household-fact-text">
                  <dt>世帯グループ名</dt>
                  <dd>{household.name}</dd>
                </dl>
              </div>
              <div className="household-fact">
                <UiIcon name="ticket" />
                <dl className="household-fact-text">
                  <dt>招待コード</dt>
                  <dd className="household-invite-code" data-testid="household-invite-code">{household.inviteCode}</dd>
                </dl>
                <button type="button" className="household-copy" aria-label="招待コードをコピー" onClick={() => void copyInviteCode()}>
                  コピー
                </button>
              </div>
              <p role="status" className="household-copy-result">{copyResult}</p>
              <div className="household-members-head">
                <h3>メンバー</h3>
                <span className="ui-tag">{household.members.length}人</span>
              </div>
              {household.members.length === 0 ? (
                <p className="ui-empty">メンバーを表示できません</p>
              ) : (
                <ul className="household-members" aria-label="メンバー">
                  {household.members.map((member) => (
                    <li key={member.userId}>
                      <UiIcon name="account" />
                      <span>{member.displayName}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="household-danger" aria-labelledby="household-danger-heading">
              <div className="household-danger-head">
                <UiIcon name="exit" tone="danger" />
                <div>
                  <h3 id="household-danger-heading">世帯グループからの退出</h3>
                  <p>退出すると、この世帯グループの共有データにアクセスできなくなります。</p>
                </div>
              </div>
              {leaveError && <p role="alert" className="error">{leaveError}</p>}
              <button type="button" className="ui-danger-outline" onClick={() => setConfirmOpen(true)}>
                世帯グループから退出する
              </button>
            </section>
          </>
        )}
      </div>
      {confirmOpen && <LeaveConfirmDialog submitting={submitting} onConfirm={() => void handleLeave()} onCancel={() => setConfirmOpen(false)} />}
    </div>
  )
}

// 退出の確認。開いたときは「キャンセル」へフォーカスを置き、送信中は閉じられないようにする。
function LeaveConfirmDialog({ submitting, onConfirm, onCancel }: { submitting: boolean; onConfirm: () => void; onCancel: () => void }) {
  const cancel = () => { if (!submitting) onCancel() }
  const ref = useDialog(cancel, '[data-cancel]')
  return (
    <div className="modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) cancel() }}>
      <div ref={ref} className="modal household-leave-modal" role="dialog" aria-modal="true" aria-labelledby="household-leave-heading">
        <h2 id="household-leave-heading">本当に退出しますか？</h2>
        <p className="hint">
          退出すると世帯グループの共有データにアクセスできなくなります。あなたが最後のメンバーの場合、世帯グループと共有データ（在庫・買い物リスト等）はすべて削除されます。
        </p>
        <div className="ui-form-actions">
          <button data-cancel type="button" className="ui-form-cancel" disabled={submitting} onClick={cancel}>
            キャンセル
          </button>
          <button type="button" className="ui-action is-danger" disabled={submitting} onClick={onConfirm}>
            退出する
          </button>
        </div>
      </div>
    </div>
  )
}

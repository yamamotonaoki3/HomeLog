import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import { getRefreshToken } from '../api/tokenStorage'
import { PasswordField } from '../components/PasswordField'
import { useAuth } from '../context/useAuth'

// 登録画面(RegisterPage)と同じパスワード規則。
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/

interface Account {
  id: number
  email: string
  displayName: string
}

type Result = { kind: 'success' | 'error'; message: string } | null

// 各フォームの見出しをregionの名前にし、成功はstatus、失敗はalertで読み上げる。
function AccountSection({ id, title, result, children }: { id: string; title: string; result: Result; children: ReactNode }) {
  return (
    <section className="panel account-settings-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
      {result && (
        <p role={result.kind === 'success' ? 'status' : 'alert'} className={result.kind === 'success' ? 'account-settings-success' : 'error'}>
          {result.message}
        </p>
      )}
    </section>
  )
}

// アカウント設定画面(#292)。表示名・パスワード・メールアドレスを変更する。
// メール送信サービス未導入のため、メールアドレスは確認メールなしで即時に変わる(F01_auth.md 8-1章)。
export function AccountSettingsPage() {
  const { updateDisplayName } = useAuth()
  const [account, setAccount] = useState<Account | null>(null)
  const [loadError, setLoadError] = useState('')

  const [displayName, setDisplayName] = useState('')
  const [nameResult, setNameResult] = useState<Result>(null)
  const [nameSaving, setNameSaving] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [passwordResult, setPasswordResult] = useState<Result>(null)
  const [passwordSaving, setPasswordSaving] = useState(false)

  const [newEmail, setNewEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [emailResult, setEmailResult] = useState<Result>(null)
  const [emailSaving, setEmailSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiClient.get<Account>('/auth/account')
      .then(({ data }) => {
        if (cancelled) return
        setAccount(data)
        setDisplayName(data.displayName)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(getApiErrorMessage(err, 'アカウント情報の取得に失敗しました。時間をおいて再度お試しください'))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleNameSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = displayName.trim()
    if (trimmed.length < 1 || trimmed.length > 50) {
      setNameResult({ kind: 'error', message: '表示名は1〜50文字で入力してください' })
      return
    }
    setNameSaving(true)
    setNameResult(null)
    try {
      const { data } = await apiClient.patch<Account>('/auth/account', { displayName: trimmed })
      setAccount(data)
      setDisplayName(data.displayName)
      updateDisplayName(data.displayName)
      setNameResult({ kind: 'success', message: '表示名を変更しました' })
    } catch (err) {
      setNameResult({ kind: 'error', message: getApiErrorMessage(err, '表示名の変更に失敗しました') })
    } finally {
      setNameSaving(false)
    }
  }

  const handlePasswordSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!PASSWORD_PATTERN.test(newPassword)) {
      setPasswordResult({ kind: 'error', message: 'パスワードは8文字以上、英字と数字を含めてください' })
      return
    }
    if (newPassword !== newPasswordConfirm) {
      setPasswordResult({ kind: 'error', message: 'パスワードが一致しません' })
      return
    }
    setPasswordSaving(true)
    setPasswordResult(null)
    try {
      // 今の端末のリフレッシュトークンを渡し、この端末はログインしたまま他の端末だけをログアウトさせる。
      await apiClient.put('/auth/password', { currentPassword, newPassword, refreshToken: getRefreshToken() ?? undefined })
      setCurrentPassword('')
      setNewPassword('')
      setNewPasswordConfirm('')
      setPasswordResult({ kind: 'success', message: 'パスワードを変更しました。ほかの端末ではログアウトされます' })
    } catch (err) {
      setPasswordResult({ kind: 'error', message: getApiErrorMessage(err, 'パスワードの変更に失敗しました') })
    } finally {
      setPasswordSaving(false)
    }
  }

  const handleEmailSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setEmailSaving(true)
    setEmailResult(null)
    try {
      const { data } = await apiClient.put<Account>('/auth/email', { currentPassword: emailPassword, newEmail: newEmail.trim() })
      setAccount(data)
      setNewEmail('')
      setEmailPassword('')
      setEmailResult({ kind: 'success', message: 'メールアドレスを変更しました。次回から新しいアドレスでログインしてください' })
    } catch (err) {
      setEmailResult({ kind: 'error', message: getApiErrorMessage(err, 'メールアドレスの変更に失敗しました') })
    } finally {
      setEmailSaving(false)
    }
  }

  return (
    <div className="page account-settings-page">
      <div className="toolbar">
        <h1>アカウント設定</h1>
        <Link to="/settings" className="btn btn-secondary">設定に戻る</Link>
      </div>
      {loadError && <p className="error" role="alert">{loadError}</p>}

      <AccountSection id="account-name-heading" title="表示名" result={nameResult}>
        <form onSubmit={handleNameSubmit} noValidate>
          <label htmlFor="account-display-name">表示名</label>
          <input
            id="account-display-name"
            type="text"
            maxLength={50}
            value={displayName}
            disabled={!account}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={!account || nameSaving}>保存</button>
        </form>
      </AccountSection>

      <AccountSection id="account-password-heading" title="パスワード" result={passwordResult}>
        <form onSubmit={handlePasswordSubmit}>
          <PasswordField id="account-current-password" label="現在のパスワード" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
          <PasswordField
            id="account-new-password"
            label="新しいパスワード（8文字以上、英字と数字を含む）"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
          />
          <PasswordField
            id="account-new-password-confirm"
            label="新しいパスワード（確認）"
            value={newPasswordConfirm}
            onChange={setNewPasswordConfirm}
            autoComplete="new-password"
          />
          <button type="submit" className="btn btn-primary" disabled={passwordSaving}>パスワードを変更</button>
        </form>
      </AccountSection>

      <AccountSection id="account-email-heading" title="メールアドレス" result={emailResult}>
        <p className="account-settings-current">
          現在のメールアドレス：<span>{account?.email ?? (loadError ? '取得できません' : '読み込み中…')}</span>
        </p>
        <p className="hint">確認メールは送信されません。変更するとすぐに新しいアドレスでログインするようになります。</p>
        <form onSubmit={handleEmailSubmit}>
          <label htmlFor="account-new-email">新しいメールアドレス</label>
          <input id="account-new-email" type="email" required autoComplete="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} />
          <PasswordField id="account-email-password" label="現在のパスワード" value={emailPassword} onChange={setEmailPassword} autoComplete="current-password" />
          <button type="submit" className="btn btn-primary" disabled={!account || emailSaving}>メールアドレスを変更</button>
        </form>
      </AccountSection>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { isAxiosError } from 'axios'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import { PasswordField } from '../components/PasswordField'

const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/
const UNAVAILABLE_MESSAGE = '現在、パスワード再設定メールを利用できません。時間をおいて、もう一度お試しください。'

interface RequestResponse {
  message: string
}

type View = 'checking' | 'check-failed' | 'unavailable' | 'request' | 'requested' | 'confirm'

/** メールのリンク(/password-reset#token=...)からトークンを読み取る。読み取るだけで消費はしない。 */
function readTokenFromHash(hash: string): string {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('token')
  return value?.trim() ?? ''
}

function errorStatus(error: unknown): number | undefined {
  return isAxiosError(error) ? error.response?.status : undefined
}

function errorCode(error: unknown): string | undefined {
  return isAxiosError<{ code?: string }>(error) ? error.response?.data?.code : undefined
}

export function PasswordResetPage() {
  const navigate = useNavigate()
  const location = useLocation()
  // トークンは状態にだけ持つ。URLには残さず、画面・ログ・ブラウザの履歴へ出さない。
  const [token, setToken] = useState(() => readTokenFromHash(location.hash))
  const [view, setView] = useState<View>(() => (readTokenFromHash(location.hash) ? 'confirm' : 'checking'))
  const [email, setEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 利用可否の確認は最後に始めたものだけを反映する(リンクを開き直した場合などに古い結果で上書きしない)。
  const checkSeq = useRef(0)
  // 確定の応答は、送った時点のリンクのものだけを反映する(別のリンクを開き直した後に古い応答で消さない)。
  const linkSeq = useRef(0)

  // 読み取り後はすぐURLのフラグメントを取り除く(再読み込みや履歴にトークンを残さない)。
  // 画面を開いたまま同じタブでメールのリンクを開き直した場合(フラグメントだけの遷移)にも対応する。
  useEffect(() => {
    if (!location.hash) return
    const linkedToken = readTokenFromHash(location.hash)
    if (linkedToken) {
      checkSeq.current += 1
      linkSeq.current += 1
      setToken(linkedToken)
      setView('confirm')
      setError('')
    }
    navigate({ pathname: location.pathname, search: location.search }, { replace: true })
  }, [location.hash, location.pathname, location.search, navigate])

  const checkAvailability = useCallback(async () => {
    const seq = ++checkSeq.current
    setView('checking')
    setError('')
    try {
      const response = await apiClient.get<{ available: boolean }>('/auth/password-reset/availability')
      if (checkSeq.current === seq) setView(response.data.available ? 'request' : 'unavailable')
    } catch {
      if (checkSeq.current === seq) setView('check-failed')
    }
  }, [])

  useEffect(() => {
    // 画面を開いたときに1回だけ確認する(メールのリンクから開いた場合は確認しない)。以降は操作から呼ぶ。
    if (!readTokenFromHash(location.hash)) void checkAvailability()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const restart = () => {
    setToken('')
    setNewPassword('')
    setNewPasswordConfirm('')
    setMessage('')
    void checkAvailability()
  }

  const handleRequest = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setError('')
    const link = linkSeq.current
    setSubmitting(true)
    try {
      const response = await apiClient.post<RequestResponse>('/auth/password-reset/request', { email: email.trim() })
      if (linkSeq.current !== link) return
      setMessage(response.data.message)
      setView('requested')
    } catch (err) {
      if (linkSeq.current !== link) return
      if (errorStatus(err) === 503) {
        setView('unavailable')
      } else {
        setError(getApiErrorMessage(err, '申請に失敗しました。時間をおいて再度お試しください'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleConfirm = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setError('')
    const link = linkSeq.current

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
      await apiClient.post('/auth/password-reset/confirm', { token, newPassword })
      // 送信後に別のリンクを開き直していたら、新しいリンクの入力を残す。
      if (linkSeq.current !== link) return
      navigate('/login', { replace: true })
    } catch (err) {
      if (linkSeq.current !== link) return
      if (errorCode(err) === 'INVALID_TOKEN') {
        setError('このリンクは無効か、期限切れです。使用済みのリンクや、再設定を申請し直した場合の以前のリンクも使えません。最新のメールのリンクを開くか、もう一度申請してください。')
        setToken('')
      } else if (!isAxiosError(err) || !err.response) {
        setError('通信に失敗しました。通信状況を確認して、もう一度お試しください')
      } else {
        setError(getApiErrorMessage(err, 'パスワードの変更に失敗しました。時間をおいて再度お試しください'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const linkExpired = view === 'confirm' && token === ''

  return (
    <div className="center-screen">
      <div className="auth-card">
        <h1>パスワードリセット</h1>
        {view === 'checking' && <p className="hint" role="status">利用状況を確認しています…</p>}
        {view === 'check-failed' && (
          <>
            <p className="error" role="alert">利用状況を確認できませんでした。通信状況を確認して、もう一度お試しください</p>
            <button type="button" className="btn btn-primary btn-block" onClick={() => void checkAvailability()}>
              再確認する
            </button>
          </>
        )}
        {view === 'unavailable' && <p className="notice-box" role="status">{UNAVAILABLE_MESSAGE}</p>}
        {view === 'request' && (
          <form onSubmit={handleRequest}>
            <p className="hint">登録したメールアドレスを入力してください。登録済みの場合、再設定用のリンクをメールでご案内します。</p>
            <label htmlFor="reset-email">メールアドレス</label>
            <input
              id="reset-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {error && <p className="error" role="alert">{error}</p>}
            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              申請する
            </button>
          </form>
        )}
        {view === 'requested' && (
          <>
            <p className="success" role="status">{message}</p>
            <ul className="hint reset-help">
              <li>メールが届くまで数分かかることがあります。迷惑メールフォルダもご確認ください。</li>
              <li>リンクの有効期限は30分です。メールのリンクを開いて、新しいパスワードを設定してください。</li>
              <li>届かない場合は、少し時間をおいてから、もう一度申請してください。申請し直すと、以前のメールのリンクは使えなくなります。最新のメールのリンクをご利用ください。</li>
            </ul>
            <button type="button" className="btn btn-secondary btn-block" onClick={() => { setError(''); setView('request') }}>
              もう一度申請する
            </button>
          </>
        )}
        {view === 'confirm' && !linkExpired && (
          <form onSubmit={handleConfirm}>
            <p className="hint">新しいパスワードを入力してください。このページを再読み込みすると、メールのリンクをもう一度開く必要があります。</p>
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
            {error && <p className="error" role="alert">{error}</p>}
            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              変更する
            </button>
          </form>
        )}
        {linkExpired && (
          <>
            {error && <p className="error" role="alert">{error}</p>}
            <button type="button" className="btn btn-primary btn-block" onClick={restart}>
              再設定を申請し直す
            </button>
          </>
        )}
        <div className="auth-links">
          <Link to="/login">ログイン画面へ戻る</Link>
        </div>
      </div>
    </div>
  )
}

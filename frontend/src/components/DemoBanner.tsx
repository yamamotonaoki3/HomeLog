import { useId, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import { DEMO_HIGHLIGHTS } from '../lib/demoHighlights'

// 残り時間は切り上げ、期限後は0時間にする。
function remainingHours(expiresAt: string): number {
  const remainingMs = new Date(expiresAt).getTime() - Date.now()
  return Number.isFinite(remainingMs) ? Math.max(0, Math.ceil(remainingMs / 3_600_000)) : 0
}

// デモ中(user.demo がある)だけ、ヘッダーの下に出す帯(#534)。通常の利用者には何も出さない。
export function DemoBanner() {
  const { user, switchDemo, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState('')
  const highlightsId = useId()
  const demo = user?.demo
  if (!user || !demo) return null

  const handleSwitch = async () => {
    setError('')
    setSwitching(true)
    try {
      await switchDemo()
    } catch (err) {
      setError(getApiErrorMessage(err, '切り替えに失敗しました。時間をおいて再度お試しください'))
      setSwitching(false)
    }
  }

  return (
    <section className="demo-banner" aria-label="デモのご案内">
      <p className="demo-banner-text">デモ中：{user.displayName}として表示しています（残り{remainingHours(demo.expiresAt)}時間）</p>
      <div className="demo-banner-actions">
        <button type="button" className="demo-banner-button" disabled={switching} onClick={() => void handleSwitch()}>
          {demo.partnerName}に切り替える
        </button>
        <button type="button" className="demo-banner-button" aria-expanded={open} aria-controls={highlightsId} onClick={() => setOpen((current) => !current)}>
          見どころ
        </button>
        <button type="button" className="demo-banner-button" onClick={() => void logout()}>
          デモを終わる
        </button>
      </div>
      <p className="demo-banner-note">デモには個人情報や実際のデータを入力しないでください。</p>
      {error && <p className="demo-banner-error">{error}</p>}
      {open && (<>
        <ul id={highlightsId} className="demo-banner-highlights">
          {DEMO_HIGHLIGHTS.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <p className="demo-banner-note">外部サービスを利用する画像解析は、デモでは停止しています。手動・WEBからのレシピ登録は試せます。</p>
      </>)}
    </section>
  )
}

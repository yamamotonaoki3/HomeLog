import { useId, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { getApiErrorMessage } from '../api/getApiErrorMessage'

const HIGHLIGHTS = [
  '家計簿・口座：太郎と花子で中身がまったく違う（本人だけのデータ）',
  '割り勘：自分の立替は、相手の画面で「支払う分」として見える',
  '在庫・買い物リスト・献立・レシピ：どちらから見ても同じ。片方が追加すると、もう片方にも出る',
  '予定・固定費：「世帯」のものは2人に、「個人」のものは本人だけに見える',
]

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
      {error && <p className="demo-banner-error">{error}</p>}
      {open && (
        <ul id={highlightsId} className="demo-banner-highlights">
          {HIGHLIGHTS.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
    </section>
  )
}

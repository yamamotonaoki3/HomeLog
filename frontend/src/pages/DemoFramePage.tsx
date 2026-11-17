import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { fetchDemoAvailability } from '../api/demo'
import { DEMO_HIGHLIGHTS } from '../lib/demoHighlights'

// この幅(px)以上のときだけ、スマホ表示の枠を出す。これ未満は端末そのものがスマホ幅なので枠は要らない。
export const DEMO_FRAME_MIN_WIDTH = 601
const WIDE_QUERY = `(min-width: ${DEMO_FRAME_MIN_WIDTH}px)`
const FRAME_TITLE = 'シェファミのデモ（スマホ表示）'
const FRAME_START_PATH = '/login'

function isWide(): boolean {
  return window.matchMedia(WIDE_QUERY).matches
}

// PCでは、アプリがスマホ用の表示に切り替わる幅(390px)の枠の中にデモを表示する入口ページ(#536)。
// デモ環境でない・スマホ幅のときは通常のログイン画面へ移る。
export function DemoFramePage() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [wide, setWide] = useState(isWide)
  const [frameKey, setFrameKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    void fetchDemoAvailability().then((result) => { if (!cancelled) setEnabled(result) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY)
    const update = () => setWide(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  // 判定中は何も出さない(ちらつき防止)。
  if (enabled === null) return null
  if (!enabled || !wide) return <Navigate to={FRAME_START_PATH} replace />

  return (
    <main className="demo-frame-page">
      <div className="demo-frame-device">
        <iframe key={frameKey} className="demo-frame-screen" title={FRAME_TITLE} src={FRAME_START_PATH} />
      </div>
      <section className="demo-frame-guide">
        <h1>シェファミのデモ</h1>
        <p>架空の2人（デモ太郎・デモ花子）の世帯で、登録なしでお試しできます。デモは24時間利用でき、期限後のデータは定期処理で削除されます。</p>
        <p>枠の中の「デモを試す」から始めて、帯のボタンで2人を切り替えてみてください。</p>
        <h2>見どころ</h2>
        <ul>
          {DEMO_HIGHLIGHTS.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <button type="button" className="demo-frame-reset" onClick={() => setFrameKey((current) => current + 1)}>
          最初の画面に戻す
        </button>
      </section>
    </main>
  )
}

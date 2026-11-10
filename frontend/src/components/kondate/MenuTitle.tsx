import { useId, useState, type ReactNode } from 'react'

/**
 * 献立のタイトル。長いタイトルは2行で省略し、押すと全文と children を表示する。
 * chevron を付けると、開閉できることを右端の印で示す(一覧の行で使う)。
 */
export function MenuTitle({ text, siteLabel, chevron = false, children }: { text: string; siteLabel?: string; chevron?: boolean; children?: ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  return <div className="menu-title">
    <button type="button" className={chevron ? 'menu-title-toggle menu-title-toggle-chevron' : 'menu-title-toggle'} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
      <span className={expanded ? 'menu-title-text' : 'menu-title-text menu-title-clamped'}>{text}</span>
      {chevron && <span className="menu-title-chevron" aria-hidden="true" />}
    </button>
    {siteLabel && <span className="menu-site">{siteLabel}</span>}
    <div id={id} className="menu-title-detail" hidden={!expanded}>{children}</div>
  </div>
}

import { useId, useState, type ReactNode } from 'react'

export function MenuTitle({ text, siteLabel, children }: { text: string; siteLabel?: string; children?: ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  return <div className="menu-title">
    <button type="button" className="menu-title-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
      <span className={expanded ? 'menu-title-text' : 'menu-title-text menu-title-clamped'}>{text}</span>
    </button>
    {siteLabel && <span className="menu-site">{siteLabel}</span>}
    <div id={id} hidden={!expanded}>{children}</div>
  </div>
}

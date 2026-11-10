import type { ReactNode } from 'react'

// 見出しの左に置く線画のアイコン。意味は隣の見出しの文字で伝えるので、読み上げには出さない。
const shapes = {
  household: <><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20v-1.5a6.5 6.5 0 0 1 13 0V20" /><circle cx="17.5" cy="9" r="2.4" /><path d="M18 14.2a4.6 4.6 0 0 1 3.5 4.4V20" /></>,
  display: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  account: <><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></>,
} satisfies Record<string, ReactNode>

export type UiIconName = keyof typeof shapes

export function UiIcon({ name }: { name: UiIconName }) {
  return (
    <span className="ui-icon-tile" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {shapes[name]}
      </svg>
    </span>
  )
}

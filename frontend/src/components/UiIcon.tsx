import type { ReactNode } from 'react'

// 見出しの左に置く線画のアイコン。意味は隣の見出しの文字で伝えるので、読み上げには出さない。
const shapes = {
  household: <><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20v-1.5a6.5 6.5 0 0 1 13 0V20" /><circle cx="17.5" cy="9" r="2.4" /><path d="M18 14.2a4.6 4.6 0 0 1 3.5 4.4V20" /></>,
  display: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  account: <><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></>,
  ticket: <><path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4Z" /><path d="M10 7v2.5M10 14.5V17" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01" /></>,
  today: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /><circle cx="12" cy="15.2" r="1.7" fill="currentColor" stroke="none" /></>,
  event: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4m-7 8.5 2 2 4-4" /></>,
  cart: <><path d="M3 4h2.5l2.2 10.5h10.2L20 7H6.4" /><circle cx="9" cy="18.7" r="1.5" /><circle cx="17" cy="18.7" r="1.5" /></>,
  coins: <><ellipse cx="12" cy="7" rx="7" ry="3" /><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></>,
  yen: <path d="m6 4 6 8 6-8M12 12v8M7.5 12h9M7.5 16h9" />,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5M12 14.5v2" /></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4.5 8 7.5 5.5L19.5 8" /></>,
  exit: <><path d="M10 4H6a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 6 20h4" /><path d="m15 8 4 4-4 4M19 12H9.5" /></>,
} satisfies Record<string, ReactNode>

export type UiIconName = keyof typeof shapes

// tone="danger" は、退出・退会のような取り消しにくい操作の見出しに使う。
export function UiIcon({ name, tone }: { name: UiIconName; tone?: 'danger' }) {
  return (
    <span className={tone === 'danger' ? 'ui-icon-tile is-danger' : 'ui-icon-tile'} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {shapes[name]}
      </svg>
    </span>
  )
}

import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useId, useRef, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { NotificationAlarm } from './NotificationAlarm'
import { useDialog } from '../hooks/useDialog'

const kakeiboPaths = ['/kakeibo', '/warikan', '/accounts', '/events', '/fixed-costs', '/categories']
const menuPaths = ['/menu', '/recipes']

function isWithinSection(pathname: string, paths: string[]) {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

function NavigationIcon({ kind }: { kind: 'home' | 'money' | 'menu' | 'inventory' | 'more' }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {kind === 'home' && <path d="m4 10 8-7 8 7v11H4Z" />}
    {kind === 'money' && <path d="m6 3 6 9 6-9M6 12h12M6 16h12M12 12v9" />}
    {kind === 'menu' && <><rect x="3" y="3" width="18" height="18" /><path d="M3 7.5h18M3 12h18M3 16.5h18M7.5 3v18M12 3v18M16.5 3v18" /></>}
    {kind === 'inventory' && <><rect x="3" y="3" width="18" height="18" /><rect x="8" y="8" width="8" height="8" fill="currentColor" stroke="none" /></>}
    {kind === 'more' && <path strokeWidth="3" strokeLinecap="butt" d="M3 5h7m4 0h7M3 12h7m4 0h7M3 19h7m4 0h7" />}
  </svg>
}

const auxiliaryLinks = [
  ['表示設定', '/settings/display'], ['世帯設定', '/household/settings'], ['カテゴリー管理', '/categories'], ['固定費', '/fixed-costs'],
  ['口座・カード管理', '/accounts'], ['割り勘', '/warikan'], ['イベント', '/events'],
  ['レシピ', '/recipes'], ['買い物リスト', '/zaiko/shopping'],
] as const

function AuxiliaryMenu({ id, onClose, onNavigate }: { id: string; onClose: () => void; onNavigate: () => void }) {
  const ref = useDialog(onClose, '[data-menu-close]')
  return <div id={id} className="auxiliary-menu-overlay" role="dialog" aria-modal="true" aria-label="その他の設定・管理" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={ref} className="auxiliary-menu-panel">
      <header className="auxiliary-menu-header"><h2>その他の設定・管理</h2><button type="button" data-menu-close aria-label="メニューを閉じる" onClick={onClose}>×</button></header>
      <div className="auxiliary-menu-body">
        <nav aria-label="その他の機能一覧">{auxiliaryLinks.map(([label, to]) => <NavLink key={to} to={to} end onClick={onNavigate}>{label}</NavLink>)}</nav>
      </div>
    </div>
  </div>
}

function AccountMenu({ id, onClose, onNavigate, onLogout }: { id: string; onClose: () => void; onNavigate: () => void; onLogout: () => void }) {
  const ref = useDialog(onClose, '[data-account-close]')
  return <div id={id} className="auxiliary-menu-overlay" role="dialog" aria-modal="true" aria-label="アカウント" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={ref} className="auxiliary-menu-panel">
      <div className="auxiliary-menu-header"><h2>アカウント</h2><button type="button" data-account-close aria-label="アカウントメニューを閉じる" onClick={onClose}>×</button></div>
      <div className="auxiliary-menu-body">
        <nav aria-label="アカウントの操作"><Link to="/settings/account" onClick={onNavigate}>アカウント設定</Link></nav>
        <button type="button" className="nav-logout" onClick={onLogout}>ログアウト</button>
      </div>
    </div>
  </div>
}

export function AppLayout() {
  const { logout, user, userStatus } = useAuth()
  const accountName = user?.displayName ?? (userStatus === 'error' ? 'アカウント名を取得できません' : '読み込み中…')
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [activeDialog, setActiveDialog] = useState<'other' | 'account' | null>(null)
  const [menuPath, setMenuPath] = useState(pathname)
  const menuId = useId()
  const accountId = useId()
  const menuTrigger = useRef<HTMLButtonElement | null>(null)
  const closeMenu = () => { setActiveDialog(null); menuTrigger.current?.focus({ preventScroll: true }) }
  const openMenu = (dialog: 'other' | 'account', trigger: HTMLButtonElement) => { menuTrigger.current = trigger; setActiveDialog(dialog) }
  if (menuPath !== pathname) { setMenuPath(pathname); setActiveDialog(null) }
  const isKakeiboSection = isWithinSection(pathname, kakeiboPaths)
  const isMenuSection = isWithinSection(pathname, menuPaths)
  const activePrimary = pathname.startsWith('/zaiko')
    ? '/zaiko'
    : isKakeiboSection
      ? '/kakeibo'
      : isMenuSection
        ? '/menu'
        : pathname === '/' ? '/' : 'other'
  const primaryNavClass = (section: string) => (activePrimary === section ? 'nav-link is-active' : 'nav-link')

  const handleLogout = () => {
    // クライアントのセッション消去直後に遷移し、旧APIの完了で新セッションを中断しない。
    void logout()
    setActiveDialog(null)
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <div className="app-top-navigation">
        <header className="global-nav">
          <div className="nav-inner">
            <NavLink to="/" className="nav-logo">
              <NavigationIcon kind="home" /><span>シェファミ</span><small>HomeLog</small>
            </NavLink>
            <nav aria-label="設定" className="account-nav">
              <NotificationAlarm />
              <NavLink to="/settings" className="settings-icon-link" aria-label="設定を開く" title="設定">
                <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3.2" />
                  <path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" />
                </svg>
              </NavLink>
            </nav>
            <div className="header-account">
              <button type="button" className="header-account-button" aria-haspopup="dialog" aria-expanded={activeDialog === 'account'} aria-controls={accountId} onClick={event => openMenu('account', event.currentTarget)}>
                <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg>
                <span className="header-account-name" title={accountName}>{accountName}</span>
              </button>
            </div>
          </div>
        </header>

        {activePrimary === '/zaiko' && (
          <nav aria-label="在庫管理関連機能" className="secondary-nav">
            {/* endを付けないと/zaiko/shoppingでも在庫一覧が選択中になる */}
            <NavLink to="/zaiko" end className="nav-link">
              在庫一覧
            </NavLink>
            <NavLink to="/zaiko/shopping" className="nav-link">
              買い物リスト
            </NavLink>
          </nav>
        )}
        {isKakeiboSection && (
          <nav aria-label="家計簿関連機能" className="secondary-nav">
            <NavLink to="/kakeibo" end className="nav-link">
              家計簿
            </NavLink>
            <NavLink to="/warikan" className="nav-link">
              割り勘
            </NavLink>
            <NavLink to="/accounts" className="nav-link">
              口座・カード管理
            </NavLink>
            <NavLink to="/events" className="nav-link">
              イベント
            </NavLink>
          </nav>
        )}
        {isMenuSection && (
          <nav aria-label="献立表関連機能" className="secondary-nav">
            <NavLink to="/menu" end className="nav-link">
              献立表
            </NavLink>
            <NavLink to="/recipes" className="nav-link">
              レシピ
            </NavLink>
          </nav>
        )}
      </div>

      <main className="app-content">
        <Outlet />
      </main>

      <nav aria-label="主要機能" className="primary-nav">
        <NavLink to="/" end className={primaryNavClass('/')}>
          <NavigationIcon kind="home" /><span>ホーム</span>
        </NavLink>
        <Link to="/menu" aria-label="献立表" title="献立表を開く" aria-current={activePrimary === '/menu' ? 'page' : undefined} className={primaryNavClass('/menu')}>
          <NavigationIcon kind="menu" /><span>献立</span>
        </Link>
        <Link to="/zaiko" aria-current={activePrimary === '/zaiko' ? 'page' : undefined} className={primaryNavClass('/zaiko')}>
          <NavigationIcon kind="inventory" /><span>在庫</span>
        </Link>
        <Link to="/kakeibo" aria-current={activePrimary === '/kakeibo' ? 'page' : undefined} className={primaryNavClass('/kakeibo')}>
          <NavigationIcon kind="money" /><span>家計簿</span>
        </Link>
        <button type="button" className={activePrimary === 'other' ? 'nav-link is-active' : 'nav-link'} aria-expanded={activeDialog === 'other'} aria-controls={menuId} onClick={event => openMenu('other', event.currentTarget)}><NavigationIcon kind="more" /><span>その他</span></button>
      </nav>
      {activeDialog === 'other' && <AuxiliaryMenu key={pathname} id={menuId} onClose={closeMenu} onNavigate={() => setActiveDialog(null)} />}
      {activeDialog === 'account' && <AccountMenu key={pathname} id={accountId} onClose={closeMenu} onNavigate={() => setActiveDialog(null)} onLogout={handleLogout} />}
    </div>
  )
}

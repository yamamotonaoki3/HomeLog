import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'

const kakeiboPaths = ['/kakeibo', '/warikan', '/accounts', '/events', '/fixed-costs', '/categories']
const menuPaths = ['/menu', '/recipes']

function isWithinSection(pathname: string, paths: string[]) {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

export function AppLayout() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isKakeiboSection = isWithinSection(pathname, kakeiboPaths)
  const isMenuSection = isWithinSection(pathname, menuPaths)
  const activePrimary = pathname.startsWith('/zaiko')
    ? '/zaiko'
    : isKakeiboSection
      ? '/kakeibo'
      : isMenuSection
        ? '/menu'
        : null
  const primaryNavClass = (section: string) => (activePrimary === section ? 'nav-link is-active' : 'nav-link')

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <header className="global-nav">
        <div className="nav-inner">
          <NavLink to="/" className="nav-logo">
            HomeLog
          </NavLink>
          <nav aria-label="設定" className="account-nav">
            <NavLink to="/settings" className="settings-icon-link" aria-label="設定を開く" title="設定">
              <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3.2" />
                <path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" />
              </svg>
            </NavLink>
            <button type="button" className="nav-logout" onClick={handleLogout}>
              ログアウト
            </button>
          </nav>
        </div>
      </header>

      {isKakeiboSection && (
        <nav aria-label="家計簿関連機能" className="secondary-nav">
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
          <NavLink to="/recipes" className="nav-link">
            レシピ
          </NavLink>
        </nav>
      )}

      <main className="app-content">
        <Outlet />
      </main>

      <nav aria-label="主要機能" className="primary-nav">
        <NavLink to="/zaiko" aria-current={activePrimary === '/zaiko' ? 'page' : undefined} className={primaryNavClass('/zaiko')}>
          在庫管理
        </NavLink>
        <NavLink to="/kakeibo" aria-current={activePrimary === '/kakeibo' ? 'page' : undefined} className={primaryNavClass('/kakeibo')}>
          家計簿
        </NavLink>
        <NavLink to="/menu" aria-current={activePrimary === '/menu' ? 'page' : undefined} className={primaryNavClass('/menu')}>
          献立表
        </NavLink>
      </nav>
    </div>
  )
}

import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'

export function AppLayout() {
  const { logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const navLinkClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'nav-link is-active' : 'nav-link')

  return (
    <>
      <nav className="global-nav">
        <div className="nav-inner">
          <NavLink to="/" className="nav-logo">
            HomeLog
          </NavLink>
          <NavLink to="/" end className={navLinkClass}>
            トップ
          </NavLink>
          <NavLink to="/zaiko" className={navLinkClass}>
            在庫管理
          </NavLink>
          <button type="button" className="nav-logout" onClick={handleLogout}>
            ログアウト
          </button>
        </div>
      </nav>
      <Outlet />
    </>
  )
}

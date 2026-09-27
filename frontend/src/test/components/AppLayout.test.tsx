import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { server } from '../mocks/server'
import { AuthProvider } from '../../context/AuthContext'
import { AppLayout } from '../../components/AppLayout'
import { SettingsPage } from '../../pages/SettingsPage'
import { clearTokens, getAccessToken, setTokens } from '../../api/tokenStorage'

function renderWithLayout(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div>ログイン画面</div>} />
          <Route element={<AppLayout />}>
            <Route path="/" element={<div>ダッシュボード本体</div>} />
            <Route path="/zaiko" element={<div>在庫画面本体</div>} />
            <Route path="/kakeibo" element={<div>家計簿画面本体</div>} />
            <Route path="/menu" element={<div>献立表画面本体</div>} />
            <Route path="/recipes" element={<div>レシピ画面本体</div>} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('AppLayout', () => {
  afterEach(() => {
    clearTokens()
  })

  it('上部に設定アイコン、下部に主要3機能を表示する', () => {
    renderWithLayout('/')

    const primaryNavigation = screen.getByRole('navigation', { name: '主要機能' })

    expect(screen.getByRole('link', { name: '設定を開く' })).toHaveAttribute('href', '/settings')
    expect(screen.queryByRole('link', { name: '表示設定' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '世帯設定' })).not.toBeInTheDocument()
    expect(within(primaryNavigation).getByRole('link', { name: '在庫管理' })).toHaveAttribute('href', '/zaiko')
    expect(within(primaryNavigation).getByRole('link', { name: '家計簿' })).toHaveAttribute('href', '/kakeibo')
    expect(within(primaryNavigation).getByRole('link', { name: '献立表' })).toHaveAttribute('href', '/menu')
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument()
    expect(screen.getByText('ダッシュボード本体')).toBeInTheDocument()
  })

  it('設定アイコンから世帯・表示・アカウント設定をまとめた画面へ移動できる', async () => {
    const user = userEvent.setup()
    renderWithLayout('/')

    await user.click(screen.getByRole('link', { name: '設定を開く' }))

    expect(await screen.findByRole('heading', { name: '設定' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '世帯設定を開く' })).toHaveAttribute('href', '/household/settings')
    expect(screen.getByRole('link', { name: '表示設定を開く' })).toHaveAttribute('href', '/settings/display')
    expect(screen.getByText('アカウント情報・メールアドレス・パスワード・退会')).toBeInTheDocument()
    expect(screen.getByText('アカウント設定機能は順次追加予定です')).toBeInTheDocument()
  })

  it('下部ナビで現在の主要機能が判別できる', () => {
    renderWithLayout('/zaiko')

    expect(screen.getByRole('link', { name: '在庫管理' })).toHaveClass('is-active')
    expect(screen.getByRole('link', { name: '家計簿' })).not.toHaveClass('is-active')
  })

  it('家計簿・献立表の関連機能へ移動できる', () => {
    const { unmount } = renderWithLayout('/kakeibo')

    const kakeiboNavigation = screen.getByRole('navigation', { name: '家計簿関連機能' })
    expect(within(kakeiboNavigation).getByRole('link', { name: '割り勘' })).toHaveAttribute('href', '/warikan')
    expect(within(kakeiboNavigation).getByRole('link', { name: '口座・カード管理' })).toHaveAttribute('href', '/accounts')
    unmount()

    renderWithLayout('/menu')
    expect(screen.getByRole('navigation', { name: '献立表関連機能' })).toContainElement(
      screen.getByRole('link', { name: 'レシピ' }),
    )
  })

  it('ログアウトでトークンが破棄され/loginへ遷移する', async () => {
    setTokens('access-token', 'refresh-token')
    server.use(http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })))
    const user = userEvent.setup()
    renderWithLayout('/')

    await user.click(screen.getByRole('button', { name: 'ログアウト' }))

    await waitFor(() => expect(screen.getByText('ログイン画面')).toBeInTheDocument())
    expect(getAccessToken()).toBeNull()
  })
})

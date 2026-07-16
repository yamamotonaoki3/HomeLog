import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { server } from '../mocks/server'
import { AuthProvider } from '../../context/AuthContext'
import { AppLayout } from '../../components/AppLayout'
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

  it('ナビのリンクと子要素が表示される', () => {
    renderWithLayout('/')

    expect(screen.getByRole('link', { name: 'トップ' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: '在庫管理' })).toHaveAttribute('href', '/zaiko')
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument()
    expect(screen.getByText('ダッシュボード本体')).toBeInTheDocument()
  })

  it('現在ページのナビリンクにis-activeが付く', () => {
    renderWithLayout('/zaiko')

    expect(screen.getByRole('link', { name: '在庫管理' })).toHaveClass('is-active')
    expect(screen.getByRole('link', { name: 'トップ' })).not.toHaveClass('is-active')
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

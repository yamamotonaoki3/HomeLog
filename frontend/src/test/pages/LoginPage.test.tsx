import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { server } from '../mocks/server'
import { AuthProvider } from '../../context/AuthContext'
import { LoginPage } from '../../pages/LoginPage'
import { clearTokens, getAccessToken } from '../../api/tokenStorage'

function renderLoginPage(initialEntries: (string | { pathname: string; state?: unknown })[] = ['/login']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>ダッシュボード</div>} />
          <Route path="/zaiko" element={<div>在庫画面</div>} />
          <Route path="/register" element={<div>登録画面</div>} />
          <Route path="/password-reset" element={<div>リセット画面</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('LoginPage', () => {
  afterEach(() => {
    clearTokens()
  })

  it('ログイン成功でトークンが保存され/へ遷移する', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ accessToken: 'access-token', refreshToken: 'refresh-token', expiresIn: 900 }),
      ),
    )
    const user = userEvent.setup()
    renderLoginPage()

    await user.type(screen.getByLabelText('メールアドレス'), 'taro@example.com')
    await user.type(screen.getByLabelText('パスワード'), 'Passw0rd')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => expect(screen.getByText('ダッシュボード')).toBeInTheDocument())
    expect(getAccessToken()).toBe('access-token')
  })

  it('RequireAuthから渡された元のパスへログイン後に戻る', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ accessToken: 'access-token', refreshToken: 'refresh-token', expiresIn: 900 }),
      ),
    )
    const user = userEvent.setup()
    renderLoginPage([{ pathname: '/login', state: { from: { pathname: '/zaiko' } } }])

    await user.type(screen.getByLabelText('メールアドレス'), 'taro@example.com')
    await user.type(screen.getByLabelText('パスワード'), 'Passw0rd')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => expect(screen.getByText('在庫画面')).toBeInTheDocument())
  })

  it('401エラー時はエラーメッセージを表示する', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ code: 'UNAUTHORIZED', message: 'メールアドレスまたはパスワードが違います' }, { status: 401 }),
      ),
    )
    const user = userEvent.setup()
    renderLoginPage()

    await user.type(screen.getByLabelText('メールアドレス'), 'taro@example.com')
    await user.type(screen.getByLabelText('パスワード'), 'wrongpass1')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() =>
      expect(screen.getByText('メールアドレスまたはパスワードが違います')).toBeInTheDocument(),
    )
    expect(getAccessToken()).toBeNull()
  })

  it('パスワードリセットと新規登録へのリンクがある', () => {
    renderLoginPage()

    expect(screen.getByRole('link', { name: 'パスワードを忘れた場合' })).toHaveAttribute('href', '/password-reset')
    expect(screen.getByRole('link', { name: '新規登録はこちら' })).toHaveAttribute('href', '/register')
  })
})

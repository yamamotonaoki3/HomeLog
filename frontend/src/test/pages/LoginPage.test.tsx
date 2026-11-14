import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
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
          <Route path="/recipes/share" element={<SharePage />} />
          <Route path="/register" element={<div>登録画面</div>} />
          <Route path="/password-reset" element={<div>リセット画面</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

function SharePage() {
  const location = useLocation()

  return <div>共有画面: {`${location.search}${location.hash}`}</div>
}

describe('LoginPage', () => {
  it('アプリ名をシェファミと表示する', () => {
    renderLoginPage()
    expect(screen.getByRole('heading', { name: 'シェファミ' })).toBeVisible()
  })

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
    renderLoginPage([{ pathname: '/login', state: { from: '/zaiko' } }])

    await user.type(screen.getByLabelText('メールアドレス'), 'taro@example.com')
    await user.type(screen.getByLabelText('パスワード'), 'Passw0rd')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => expect(screen.getByText('在庫画面')).toBeInTheDocument())
  })

  it('クエリパラメータとハッシュを含む元のURLへログイン後に戻る', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ accessToken: 'access-token', refreshToken: 'refresh-token', expiresIn: 900 }),
      ),
    )
    const user = userEvent.setup()
    const from = '/recipes/share?url=https%3A%2F%2Fexample.com%2Frecipe%3Fid%3D1#details'
    renderLoginPage([{ pathname: '/login', state: { from } }])

    await user.type(screen.getByLabelText('メールアドレス'), 'taro@example.com')
    await user.type(screen.getByLabelText('パスワード'), 'Passw0rd')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() =>
      expect(
        screen.getByText('共有画面: ?url=https%3A%2F%2Fexample.com%2Frecipe%3Fid%3D1#details'),
      ).toBeInTheDocument(),
    )
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

describe('LoginPage のデモ(#534)', () => {
  afterEach(() => {
    clearTokens()
  })

  it('GET /api/demo が enabled: true のときだけデモのボタンと説明を出す', async () => {
    server.use(http.get('/api/demo', () => HttpResponse.json({ enabled: true })))
    renderLoginPage()
    expect(await screen.findByRole('button', { name: 'デモを試す（登録不要）' })).toBeVisible()
    expect(screen.getByText('架空の2人の世帯で、24時間お試しできます')).toBeVisible()
  })

  it('enabled: false ではデモのボタンを出さない', async () => {
    let called = false
    server.use(http.get('/api/demo', () => { called = true; return HttpResponse.json({ enabled: false }) }))
    renderLoginPage()
    await waitFor(() => expect(called).toBe(true))
    expect(screen.queryByRole('button', { name: /デモを試す/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/お試しできます/)).not.toBeInTheDocument()
  })

  it('GET /api/demo が失敗してもボタンを出さず、ログインは使える', async () => {
    let called = false
    server.use(http.get('/api/demo', () => { called = true; return HttpResponse.json({ message: 'x' }, { status: 500 }) }))
    renderLoginPage()
    await waitFor(() => expect(called).toBe(true))
    expect(screen.queryByRole('button', { name: /デモを試す/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ログイン' })).toBeEnabled()
  })

  it('押すと /demo/start を呼び、トークンを保存してホームへ進む', async () => {
    server.use(
      http.get('/api/demo', () => HttpResponse.json({ enabled: true })),
      http.post('/api/demo/start', () => HttpResponse.json({ accessToken: 'demo-access', refreshToken: 'demo-refresh', expiresIn: 900 }, { status: 201 })),
    )
    const user = userEvent.setup()
    renderLoginPage()
    await user.click(await screen.findByRole('button', { name: 'デモを試す（登録不要）' }))
    await waitFor(() => expect(screen.getByText('ダッシュボード')).toBeInTheDocument())
    expect(getAccessToken()).toBe('demo-access')
  })

  it.each([
    [429, 'TOO_MANY_REQUESTS', 'リクエストが多すぎます。時間をおいて試してください'],
    [503, 'DEMO_CAPACITY_REACHED', '混み合っています。時間をおいて試してください'],
  ])('%i のときはサーバーの文言を表示し、ログインしない', async (status, code, message) => {
    server.use(
      http.get('/api/demo', () => HttpResponse.json({ enabled: true })),
      http.post('/api/demo/start', () => HttpResponse.json({ code, message }, { status })),
    )
    const user = userEvent.setup()
    renderLoginPage()
    await user.click(await screen.findByRole('button', { name: 'デモを試す（登録不要）' }))
    expect(await screen.findByText(message)).toBeVisible()
    expect(screen.queryByText('ダッシュボード')).not.toBeInTheDocument()
    expect(getAccessToken()).toBeNull()
  })
})

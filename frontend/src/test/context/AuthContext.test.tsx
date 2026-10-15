import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
import { apiClient } from '../../api/client'
import { AuthProvider } from '../../context/AuthContext'
import { useAuth } from '../../context/useAuth'
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from '../../api/tokenStorage'

function TestConsumer() {
  const { isAuthenticated, login, logout, user, userStatus } = useAuth()
  return (
    <div>
      <span data-testid="name">{user?.displayName}</span>
      <span data-testid="user-status">{userStatus}</span>
      <span data-testid="status">{isAuthenticated ? 'authenticated' : 'anonymous'}</span>
      <button onClick={() => login('taro@example.com', 'password123')}>login</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  )
}

describe('AuthContext', () => {
  it('認証済みで再ログインすると前の名前を消し本人情報を再取得する', async () => {
    setTokens('a-access', 'a-refresh')
    let resolveNext!: (value: { data: { id: number; displayName: string } }) => void
    const next = new Promise<{ data: { id: number; displayName: string } }>((resolve) => { resolveNext = resolve })
    const get = vi.spyOn(apiClient, 'get').mockResolvedValueOnce({ data: { id: 1, displayName: 'testuser_A' } }).mockImplementationOnce(() => next)
    server.use(http.post('/api/auth/login', () => HttpResponse.json({ accessToken: 'b-access', refreshToken: 'b-refresh', expiresIn: 900 })))
    try {
      render(<AuthProvider><TestConsumer /></AuthProvider>)
      expect(await screen.findByText('testuser_A')).toBeInTheDocument()
      await userEvent.click(screen.getByText('login'))
      await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
      expect(screen.getByTestId('name')).toBeEmptyDOMElement()
      expect(screen.getByTestId('user-status')).toHaveTextContent('loading')
      await act(async () => { resolveNext({ data: { id: 2, displayName: 'testuser_B' } }); await next })
      expect(await screen.findByText('testuser_B')).toBeInTheDocument()
    } finally { get.mockRestore() }
  })

  it.each(['success', 'failure'])('再ログイン後に前セッションの遅い%s応答を破棄する', async (result) => {
    setTokens('a-access', 'a-refresh')
    let resolveOld!: (value: { data: { id: number; displayName: string } }) => void
    let rejectOld!: (reason: Error) => void
    const old = new Promise<{ data: { id: number; displayName: string } }>((resolve, reject) => { resolveOld = resolve; rejectOld = reject })
    // Abortに従わない応答でも、セッション世代による破棄を検証する。
    const get = vi.spyOn(apiClient, 'get').mockImplementationOnce(() => old).mockResolvedValueOnce({ data: { id: 2, displayName: 'testuser_B' } })
    server.use(http.post('/api/auth/login', () => HttpResponse.json({ accessToken: 'b-access', refreshToken: 'b-refresh', expiresIn: 900 })))
    try {
      render(<AuthProvider><TestConsumer /></AuthProvider>)
      await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
      await userEvent.click(screen.getByText('login'))
      expect(await screen.findByText('testuser_B')).toBeInTheDocument()
      await act(async () => {
        if (result === 'success') resolveOld({ data: { id: 1, displayName: 'testuser_A' } })
        else rejectOld(new Error('testuser_A request failed'))
        await old.catch(() => {})
      })
      expect(screen.getByTestId('name')).toHaveTextContent('testuser_B')
      expect(screen.getByTestId('user-status')).toHaveTextContent('ready')
    } finally { get.mockRestore() }
  })

  it('未認証では本人APIを呼ばない', async () => {
    const handler = vi.fn(() => HttpResponse.json({ id: 1, displayName: 'testuser_me' }))
    server.use(http.get('/api/auth/me', handler))
    render(<AuthProvider><TestConsumer /></AuthProvider>)
    await act(async () => {})
    expect(handler).not.toHaveBeenCalled()
  })

  it('保存済みセッションから本人を取得しログアウト開始時に消去する', async () => {
    setTokens('access-token', 'refresh-token')
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    server.use(http.post('/api/auth/logout', async () => { await pending; return new HttpResponse(null, { status: 204 }) }))
    render(<AuthProvider><TestConsumer /></AuthProvider>)
    expect(await screen.findByText('testuser_me')).toBeInTheDocument()
    await userEvent.click(screen.getByText('logout'))
    expect(screen.getByTestId('name')).toBeEmptyDOMElement()
    expect(screen.getByTestId('status')).toHaveTextContent('anonymous')
    await act(async () => { release() })
  })

  it('ログイン後に本人情報を取得する', async () => {
    server.use(http.post('/api/auth/login', () => HttpResponse.json({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 })))
    render(<AuthProvider><TestConsumer /></AuthProvider>)
    await userEvent.click(screen.getByText('login'))
    expect(await screen.findByText('testuser_me')).toBeInTheDocument()
  })

  it('401はrefresh成功後に本人情報を取得する', async () => {
    setTokens('old-access', 'refresh-token')
    server.use(http.get('/api/auth/me', ({ request }) => request.headers.get('Authorization') === 'Bearer new-access'
      ? HttpResponse.json({ id: 2, displayName: 'testuser_refreshed' }) : new HttpResponse(null, { status: 401 })),
      http.post('/api/auth/refresh', () => HttpResponse.json({ accessToken: 'new-access', expiresIn: 900 })))
    render(<AuthProvider><TestConsumer /></AuthProvider>)
    expect(await screen.findByText('testuser_refreshed')).toBeInTheDocument()
  })

  it('refresh失敗で認証状態と本人名を消去する', async () => {
    setTokens('access-token', 'refresh-token')
    server.use(http.get('/api/auth/me', () => new HttpResponse(null, { status: 401 })),
      http.post('/api/auth/refresh', () => new HttpResponse(null, { status: 401 })))
    render(<AuthProvider><TestConsumer /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'))
    expect(screen.getByTestId('name')).toBeEmptyDOMElement()
    expect(getRefreshToken()).toBeNull()
  })

  it('A取得中にlogoutしてBへ切り替えてもAの遅い応答を反映しない', async () => {
    setTokens('a-access', 'a-refresh')
    let release!: () => void
    let started!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const requested = new Promise<void>((resolve) => { started = resolve })
    server.use(http.get('/api/auth/me', async ({ request }) => {
      if (request.headers.get('Authorization') === 'Bearer a-access') {
        started(); await pending
        return HttpResponse.json({ id: 1, displayName: 'testuser_A' })
      }
      return HttpResponse.json({ id: 2, displayName: 'testuser_B' })
    }), http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
    http.post('/api/auth/login', () => HttpResponse.json({ accessToken: 'b-access', refreshToken: 'b-refresh', expiresIn: 900 })))
    render(<AuthProvider><TestConsumer /></AuthProvider>)
    await requested
    await userEvent.click(screen.getByText('logout'))
    await userEvent.click(screen.getByText('login'))
    expect(await screen.findByText('testuser_B')).toBeInTheDocument()
    await act(async () => { release(); await pending })
    expect(screen.getByTestId('name')).toHaveTextContent('testuser_B')
    expect(screen.queryByText('testuser_A')).not.toBeInTheDocument()
  })

  afterEach(() => {
    clearTokens()
  })

  it('初期状態はrefreshTokenがなければ未認証', () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )

    expect(screen.getByTestId('status').textContent).toBe('anonymous')
  })

  it('ログイン成功でisAuthenticatedがtrueになりトークンが保存される', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ accessToken: 'access-token', refreshToken: 'refresh-token', expiresIn: 900 }),
      ),
    )
    const user = userEvent.setup()
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )

    await user.click(screen.getByText('login'))

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    expect(getAccessToken()).toBe('access-token')
    expect(getRefreshToken()).toBe('refresh-token')
  })

  it('ログアウトでisAuthenticatedがfalseに戻りトークンが破棄される', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ accessToken: 'access-token', refreshToken: 'refresh-token', expiresIn: 900 }),
      ),
      http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
    )
    const user = userEvent.setup()
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    await user.click(screen.getByText('login'))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))

    await act(async () => {
      await user.click(screen.getByText('logout'))
    })

    expect(screen.getByTestId('status').textContent).toBe('anonymous')
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })
})

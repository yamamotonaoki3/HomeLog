import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { server } from '../mocks/server'
import { AuthProvider } from '../../context/AuthContext'
import { useAuth } from '../../context/useAuth'
import { clearTokens, getAccessToken, getRefreshToken } from '../../api/tokenStorage'

function TestConsumer() {
  const { isAuthenticated, login, logout } = useAuth()
  return (
    <div>
      <span data-testid="status">{isAuthenticated ? 'authenticated' : 'anonymous'}</span>
      <button onClick={() => login('taro@example.com', 'password123')}>login</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  )
}

describe('AuthContext', () => {
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

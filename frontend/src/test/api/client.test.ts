import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { apiClient, setOnAuthExpired } from '../../api/client'
import { clearTokens, getAccessToken, setTokens } from '../../api/tokenStorage'

describe('apiClient', () => {
  beforeEach(() => {
    clearTokens()
    setOnAuthExpired(null)
  })

  afterEach(() => {
    clearTokens()
    setOnAuthExpired(null)
  })

  it('保存済みのアクセストークンをAuthorizationヘッダーに付与する', async () => {
    setTokens('initial-access-token', 'initial-refresh-token')
    let receivedAuthHeader: string | null = null
    server.use(
      http.get('/api/ping', ({ request }) => {
        receivedAuthHeader = request.headers.get('authorization')
        return HttpResponse.json({ ok: true })
      }),
    )

    await apiClient.get('/ping')

    expect(receivedAuthHeader).toBe('Bearer initial-access-token')
  })

  it('401発生時はrefreshを呼んで新しいアクセストークンでリトライする', async () => {
    setTokens('expired-access-token', 'valid-refresh-token')
    let pingCallCount = 0
    server.use(
      http.get('/api/ping', ({ request }) => {
        pingCallCount += 1
        const authHeader = request.headers.get('authorization')
        if (authHeader === 'Bearer expired-access-token') {
          return HttpResponse.json({ code: 'UNAUTHORIZED', message: '認証が必要です' }, { status: 401 })
        }
        return HttpResponse.json({ ok: true })
      }),
      http.post('/api/auth/refresh', () =>
        HttpResponse.json({ accessToken: 'new-access-token', expiresIn: 900 }),
      ),
    )

    const response = await apiClient.get('/ping')

    expect(response.data).toEqual({ ok: true })
    expect(pingCallCount).toBe(2)
    expect(getAccessToken()).toBe('new-access-token')
  })

  it('refreshが失敗した場合はトークンを破棄しonAuthExpiredを呼ぶ', async () => {
    setTokens('expired-access-token', 'invalid-refresh-token')
    const onAuthExpired = vi.fn()
    setOnAuthExpired(onAuthExpired)
    server.use(
      http.get('/api/ping', () =>
        HttpResponse.json({ code: 'UNAUTHORIZED', message: '認証が必要です' }, { status: 401 }),
      ),
      http.post('/api/auth/refresh', () =>
        HttpResponse.json({ code: 'INVALID_TOKEN', message: 'リフレッシュトークンが無効です' }, { status: 400 }),
      ),
    )

    await expect(apiClient.get('/ping')).rejects.toBeTruthy()

    expect(onAuthExpired).toHaveBeenCalledOnce()
    expect(getAccessToken()).toBeNull()
  })
  it('refresh中に別アカウントでログインし直した場合、古いrefresh結果で新しいトークンを上書きしない', async () => {
    setTokens('a-expired-access-token', 'a-refresh-token')
    const onAuthExpired = vi.fn()
    setOnAuthExpired(onAuthExpired)
    server.use(
      http.get('/api/ping', () =>
        HttpResponse.json({ code: 'UNAUTHORIZED', message: '認証が必要です' }, { status: 401 }),
      ),
      http.post('/api/auth/refresh', () => {
        setTokens('b-access-token', 'b-refresh-token')
        return HttpResponse.json({ accessToken: 'a-new-access-token', expiresIn: 900 })
      }),
    )

    await expect(apiClient.get('/ping')).rejects.toThrow()

    expect(getAccessToken()).toBe('b-access-token')
    expect(onAuthExpired).not.toHaveBeenCalled()
  })

  it('refresh失敗時でも別アカウントへ切り替わっていれば新しいセッションを消さない', async () => {
    setTokens('a-expired-access-token', 'a-refresh-token')
    const onAuthExpired = vi.fn()
    setOnAuthExpired(onAuthExpired)
    server.use(
      http.get('/api/ping', () =>
        HttpResponse.json({ code: 'UNAUTHORIZED', message: '認証が必要です' }, { status: 401 }),
      ),
      http.post('/api/auth/refresh', () => {
        setTokens('b-access-token', 'b-refresh-token')
        return HttpResponse.json({ code: 'UNAUTHORIZED', message: '無効です' }, { status: 401 })
      }),
    )

    await expect(apiClient.get('/ping')).rejects.toThrow()

    expect(getAccessToken()).toBe('b-access-token')
    expect(onAuthExpired).not.toHaveBeenCalled()
  })
})

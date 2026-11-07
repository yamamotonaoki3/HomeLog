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


describe('購入の固定認証', () => {
  afterEach(() => { clearTokens(); setOnAuthExpired(null) })
  it('明示Bearerを現在tokenへ付替えず401でもrefresh・再送・失効処理をしない', async () => {
    setTokens('testuser_b_access', 'testuser_b_refresh')
    const expired = vi.fn()
    setOnAuthExpired(expired)
    let posts = 0
    let refreshes = 0
    let actor = ''
    server.use(
      http.post('/api/shopping-list-items/purchases', ({ request }) => {
        posts++
        actor = request.headers.get('authorization') === 'Bearer testuser_a_access' ? 'A' : 'other'
        return HttpResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 })
      }),
      http.post('/api/auth/refresh', () => { refreshes++; return HttpResponse.json({}, { status: 400 }) }),
    )
    const config = { authMode: 'bound-no-refresh' as const, headers: { Authorization: 'Bearer testuser_a_access' } }
    await expect(apiClient.post('/shopping-list-items/purchases', {}, config)).rejects.toBeTruthy()
    expect({ actor, posts, refreshes }).toEqual({ actor: 'A', posts: 1, refreshes: 0 })
    expect(expired).not.toHaveBeenCalled()
    expect(getAccessToken() === 'testuser_b_access').toBe(true)
  })
  it('固定認証で明示Bearerが無ければ送信しない', async () => {
    setTokens('testuser_b_access', 'testuser_b_refresh')
    let gets = 0
    server.use(http.get('/api/auth/me', () => { gets++; return HttpResponse.json({ id: 2 }) }))
    const config = { authMode: 'bound-no-refresh' as const }
    await expect(apiClient.get('/auth/me', config)).rejects.toBeTruthy()
    expect(gets).toBe(0)
  })
})

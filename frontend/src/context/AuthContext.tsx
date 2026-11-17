import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { apiClient, setOnAuthExpired } from '../api/client'
import { clearTokens, getRefreshToken, setTokens } from '../api/tokenStorage'
import { AuthContext, type AuthUser } from './authContextValue'

interface LoginResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => getRefreshToken() !== null)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [userStatus, setUserStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const generation = useRef(0)
  const [sessionVersion, setSessionVersion] = useState(0)
  const resetSession = useCallback(() => {
    generation.current += 1
    setUser(null)
    setUserStatus('loading')
    setIsAuthenticated(false)
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return
    const controller = new AbortController()
    const current = ++generation.current
    apiClient.get<AuthUser>('/auth/me', { signal: controller.signal })
      .then(({ data }) => {
        if (current !== generation.current || controller.signal.aborted) return
        setUser(data)
        setUserStatus('ready')
      })
      .catch(() => {
        if (current !== generation.current || controller.signal.aborted) return
        setUserStatus('error')
      })
    return () => { controller.abort() }
  }, [isAuthenticated, sessionVersion])

  useEffect(() => {
    setOnAuthExpired(resetSession)
    return () => setOnAuthExpired(null)
  }, [resetSession])

  const startSession = useCallback((tokens: LoginResponse) => {
    setTokens(tokens.accessToken, tokens.refreshToken)
    generation.current += 1
    setUser(null)
    setUserStatus('loading')
    setSessionVersion((version) => version + 1)
    setIsAuthenticated(true)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const response = await apiClient.post<LoginResponse>('/auth/login', { email, password })
    startSession(response.data)
  }, [startSession])

  // 退会の取り消し期間中のアカウントで、取り消しと同時にログインする(#298)。
  const cancelDeletion = useCallback(async (email: string, password: string) => {
    const response = await apiClient.post<LoginResponse>('/auth/account/deletion/cancel', { email, password })
    startSession(response.data)
  }, [startSession])

  const startDemo = useCallback(async () => {
    const response = await apiClient.post<LoginResponse>('/demo/start')
    startSession(response.data)
  }, [startSession])

  // 相手のトークンを保存してから読み込み直し、前の人の表示を残さない。
  const switchDemo = useCallback(async () => {
    const refreshToken = getRefreshToken()
    const response = await apiClient.post<LoginResponse>('/demo/switch', { refreshToken })
    setTokens(response.data.accessToken, response.data.refreshToken)
    window.location.assign('/')
  }, [])

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken()
    clearTokens()
    resetSession()
    if (refreshToken) {
      try {
        await apiClient.post('/auth/logout', { refreshToken })
      } catch {
        // ベストエフォート：ログアウトAPIが失敗してもクライアント側の状態は必ずクリアする
      }
    }
  }, [resetSession])

  const updateDisplayName = useCallback((displayName: string) => {
    setUser((current) => (current ? { ...current, displayName } : current))
  }, [])

  const value = useMemo(
    () => ({ isAuthenticated, user, userStatus, login, cancelDeletion, logout, startDemo, switchDemo, updateDisplayName }),
    [isAuthenticated, user, userStatus, login, cancelDeletion, logout, startDemo, switchDemo, updateDisplayName],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

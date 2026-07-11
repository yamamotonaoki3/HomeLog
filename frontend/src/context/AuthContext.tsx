import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiClient, setOnAuthExpired } from '../api/client'
import { clearTokens, getRefreshToken, setTokens } from '../api/tokenStorage'
import { AuthContext } from './authContextValue'

interface LoginResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => getRefreshToken() !== null)

  useEffect(() => {
    setOnAuthExpired(() => setIsAuthenticated(false))
    return () => setOnAuthExpired(null)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const response = await apiClient.post<LoginResponse>('/auth/login', { email, password })
    setTokens(response.data.accessToken, response.data.refreshToken)
    setIsAuthenticated(true)
  }, [])

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken()
    if (refreshToken) {
      try {
        await apiClient.post('/auth/logout', { refreshToken })
      } catch {
        // ベストエフォート：ログアウトAPIが失敗してもクライアント側の状態は必ずクリアする
      }
    }
    clearTokens()
    setIsAuthenticated(false)
  }, [])

  const value = useMemo(
    () => ({ isAuthenticated, login, logout }),
    [isAuthenticated, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

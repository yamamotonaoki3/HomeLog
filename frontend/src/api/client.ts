import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { clearTokens, getAccessToken, getRefreshToken, setAccessToken } from './tokenStorage'

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean
}

interface RefreshResponse {
  accessToken: string
  expiresIn: number
}

type AuthExpiredHandler = () => void

const REFRESH_PATH = '/auth/refresh'
const LOGIN_PATH = '/auth/login'

let authExpiredHandler: AuthExpiredHandler | null = null
let refreshPromise: Promise<string> | null = null

export function setOnAuthExpired(handler: AuthExpiredHandler | null): void {
  authExpiredHandler = handler
}

export const apiClient = axios.create({ baseURL: '/api' })

async function refreshAccessToken(): Promise<string> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    throw new Error('リフレッシュトークンがありません')
  }
  const response = await axios.post<RefreshResponse>('/api/auth/refresh', { refreshToken })
  setAccessToken(response.data.accessToken)
  return response.data.accessToken
}

apiClient.interceptors.request.use((config) => {
  const accessToken = getAccessToken()
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`)
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined
    const isAuthEndpoint =
      originalRequest?.url?.includes(REFRESH_PATH) || originalRequest?.url?.includes(LOGIN_PATH)

    if (error.response?.status !== 401 || !originalRequest || originalRequest._retry || isAuthEndpoint) {
      return Promise.reject(error)
    }

    originalRequest._retry = true

    try {
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null
        })
      }
      const newAccessToken = await refreshPromise
      originalRequest.headers.set('Authorization', `Bearer ${newAccessToken}`)
      return apiClient(originalRequest)
    } catch (refreshError) {
      clearTokens()
      authExpiredHandler?.()
      return Promise.reject(refreshError)
    }
  },
)

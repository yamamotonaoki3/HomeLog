const ACCESS_TOKEN_KEY = 'homelog.accessToken'
const REFRESH_TOKEN_KEY = 'homelog.refreshToken'

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
}

export function setAccessToken(accessToken: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

/**
 * アクセストークン(JWT)の `sub` クレームからログイン中ユーザーのIDを取り出す。
 * バックエンドの signAccessToken は `sub` に String(userId) を入れている。
 * トークンが無い・壊れている場合は null。
 */
export function getCurrentUserId(): number | null {
  const token = getAccessToken()
  if (!token) return null
  const payloadPart = token.split('.')[1]
  if (!payloadPart) return null
  try {
    const payload = JSON.parse(atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string }
    const userId = Number(payload.sub)
    return Number.isInteger(userId) ? userId : null
  } catch {
    return null
  }
}

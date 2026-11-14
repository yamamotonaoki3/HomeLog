import { drizzle } from 'drizzle-orm/d1'
import { refreshTokens } from '../db/schema'
import { generateOpaqueToken, sha256Hex } from './crypto'
import { signAccessToken } from './jwt'
import type { Bindings } from '../index'

export interface TokenResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

/** アクセストークンとリフレッシュトークンを発行する(ログイン・退会の取り消し・デモの開始と切り替えで共有)。 */
export async function issueTokens(env: Bindings, userId: number): Promise<TokenResponse> {
  const accessExpirationSeconds = Number(env.JWT_ACCESS_EXPIRATION_SECONDS)
  const refreshExpirationSeconds = Number(env.JWT_REFRESH_EXPIRATION_SECONDS)

  const accessToken = await signAccessToken(userId, env.JWT_SECRET, accessExpirationSeconds)
  const refreshToken = generateOpaqueToken()
  await drizzle(env.DB).insert(refreshTokens).values({
    userId,
    tokenHash: await sha256Hex(refreshToken),
    expiresAt: new Date(Date.now() + refreshExpirationSeconds * 1000).toISOString(),
  })
  return { accessToken, refreshToken, expiresIn: accessExpirationSeconds }
}

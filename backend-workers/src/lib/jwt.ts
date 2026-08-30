import { sign, verify } from 'hono/jwt'

// アクセストークンの生成・検証。既存Java実装と同様、クレームはsub(userId)のみを持つ
// 最小構成とする(ロール・世帯情報等は埋め込まない)。

export async function signAccessToken(userId: number, secret: string, expiresInSeconds: number): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  return sign(
    {
      sub: String(userId),
      iat: nowSeconds,
      exp: nowSeconds + expiresInSeconds,
    },
    secret,
  )
}

/**
 * アクセストークンを検証し、userIdを返す。検証に失敗した場合は例外を投げる。
 */
export async function verifyAccessToken(token: string, secret: string): Promise<number> {
  const payload = await verify(token, secret, 'HS256')
  const userId = Number(payload.sub)
  if (!Number.isInteger(userId)) {
    throw new Error('トークンのsubが不正です')
  }
  return userId
}

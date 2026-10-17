import type { MiddlewareHandler } from 'hono'
import { errorResponse } from '../lib/errors'
import { verifyAccessToken } from '../lib/jwt'
import type { AppEnv } from '../index'

const UNAUTHORIZED_MESSAGE = '認証が必要です'

/**
 * Authorization: Bearer <アクセストークン> ヘッダーを検証し、userIdをコンテキストにセットする。
 * トークンが無い・無効・期限切れの場合は401を返す(既存Java実装のJwtAuthenticationFilter/
 * JwtAuthenticationEntryPointと同じ挙動)。
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization')
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null

  if (!token) {
    return c.json(errorResponse('UNAUTHORIZED', UNAUTHORIZED_MESSAGE), 401)
  }

  try {
    const userId = await verifyAccessToken(token, c.env.JWT_SECRET)
    c.set('userId', userId)
  } catch {
    return c.json(errorResponse('UNAUTHORIZED', UNAUTHORIZED_MESSAGE), 401)
  }

  // 退会の申し込み中・退会済みのアカウントは、未失効のアクセストークンでも拒否する(F01_auth.md 8-2章)。
  const active = await c.env.DB
    .prepare('SELECT 1 AS ok FROM users WHERE id = ? AND deletion_requested_at IS NULL AND deleted_at IS NULL')
    .bind(c.get('userId'))
    .first()
  if (!active) {
    return c.json(errorResponse('UNAUTHORIZED', UNAUTHORIZED_MESSAGE), 401)
  }

  await next()
}

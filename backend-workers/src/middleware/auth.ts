import type { MiddlewareHandler } from 'hono'
import { errorResponse } from '../lib/errors'
import { isDemoMode } from '../lib/demo'
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
  // デモ環境(DEMO_MODE)だけ、期限切れのデモ利用者も拒否する(削除までの最大1時間の間)。本番ではSQLを変えない。
  const demo = isDemoMode(c.env)
  const active = await c.env.DB
    .prepare(
      `SELECT 1 AS ok FROM users WHERE id = ? AND deletion_requested_at IS NULL AND deleted_at IS NULL${
        demo
          ? ' AND NOT EXISTS (SELECT 1 FROM demo_households d WHERE (d.primary_user_id = users.id OR d.partner_user_id = users.id) AND d.expires_at <= ?)'
          : ''
      }`,
    )
    .bind(...(demo ? [c.get('userId'), new Date().toISOString()] : [c.get('userId')]))
    .first()
  if (!active) {
    return c.json(errorResponse('UNAUTHORIZED', UNAUTHORIZED_MESSAGE), 401)
  }

  await next()
}

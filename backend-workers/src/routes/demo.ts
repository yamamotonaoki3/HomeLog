import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { sha256Hex } from '../lib/crypto'
import { DEMO_MAX_ACTIVE, findDemoMembership, isDemoMode } from '../lib/demo'
import { createDemoHousehold } from '../lib/demo-seed'
import { errorResponse } from '../lib/errors'
import { RATE_LIMITS, TOO_MANY_REQUESTS_MESSAGE, clientAddressKey, consumeRateLimits } from '../lib/rate-limit'
import { issueTokens } from '../lib/tokens'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

// デモ環境(2アカウント切り替え)のAPI(#532)。DEMO_MODE が "true" のときだけ start・switch が動く。
const NOT_FOUND_MESSAGE = '見つかりません'
const CAPACITY_MESSAGE = '混み合っています。時間をおいて試してください'

const switchSchema = z.object({ refreshToken: z.string().min(1) })

export const demoRoute = new Hono<AppEnv>()

// 本番(DEMO_MODE なし)では、存在しないパスと同じ404を返す。認証より前に判定する。
const requireDemoMode: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isDemoMode(c.env)) return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)
  await next()
}

async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

// 画面が「デモを試す」ボタンの出し分けに使う。本番でも200でfalseを返す。
demoRoute.get('/', (c) => c.json({ enabled: isDemoMode(c.env) }))

demoRoute.post('/start', requireDemoMode, async (c) => {
  const allowed = await consumeRateLimits(c.env.DB, [
    { rule: RATE_LIMITS.demoStartAddress, key: clientAddressKey(c.req.header('CF-Connecting-IP')) },
  ])
  if (!allowed) return c.json(errorResponse('TOO_MANY_REQUESTS', TOO_MANY_REQUESTS_MESSAGE), 429)

  // 上限の確認と作成は別の処理のため、同時に来たときはわずかに超えることがある(緩い上限として扱う)。
  const active = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM demo_households WHERE expires_at > ?')
    .bind(new Date().toISOString())
    .first<{ n: number }>()
  if ((active?.n ?? 0) >= DEMO_MAX_ACTIVE) {
    return c.json(errorResponse('DEMO_CAPACITY_REACHED', CAPACITY_MESSAGE), 503)
  }

  const demo = await createDemoHousehold(c.env.DB, new Date())
  return c.json(await issueTokens(c.env, demo.primaryUserId), 201)
})

// 今のデモ利用者から、同じデモ世帯のもう1人へ切り替える。今のリフレッシュトークンは失効させる。
demoRoute.post('/switch', requireDemoMode, requireAuth, async (c) => {
  const parsed = switchSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const userId = c.get('userId')
  const membership = await findDemoMembership(c.env.DB, userId)
  if (!membership) return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)

  // 本人の未失効のリフレッシュトークンだけを失効させる(他人のトークンを送られても何も起きない)。
  const now = new Date().toISOString()
  const revoked = await c.env.DB.prepare(
    'UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?',
  )
    .bind(now, await sha256Hex(parsed.data.refreshToken), userId, now)
    .run()
  if (revoked.meta.changes === 0) return c.json(errorResponse('RESOURCE_NOT_FOUND', NOT_FOUND_MESSAGE), 404)

  const partnerUserId = membership.primaryUserId === userId ? membership.partnerUserId : membership.primaryUserId
  return c.json(await issueTokens(c.env, partnerUserId))
})

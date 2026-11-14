import type { MiddlewareHandler } from 'hono'
import { isDemoMode } from '../lib/demo'
import { errorResponse } from '../lib/errors'
import type { AppEnv } from '../index'

// デモ環境(#532)で止めるAPI。登録・パスワードやメールの変更・退会・パスワード再設定・世帯の作成と変更・画像の解析。
// 表示名の変更(PATCH /api/auth/account)やレシピのURL登録(POST /api/recipes/from-url)などは止めない。
export const DEMO_DISABLED_ROUTES: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'POST', path: '/api/auth/register' },
  { method: 'PUT', path: '/api/auth/password' },
  { method: 'PUT', path: '/api/auth/email' },
  { method: 'POST', path: '/api/auth/account/deletion' },
  { method: 'POST', path: '/api/auth/account/deletion/cancel' },
  { method: 'POST', path: '/api/auth/password-reset/request' },
  { method: 'POST', path: '/api/auth/password-reset/confirm' },
  { method: 'POST', path: '/api/households' },
  { method: 'POST', path: '/api/households/join' },
  { method: 'POST', path: '/api/households/leave' },
  { method: 'POST', path: '/api/households/invite-code/regenerate' },
  { method: 'POST', path: '/api/recipes/ocr/upload' },
  { method: 'POST', path: '/api/recipes/ocr/analyze' },
]

const DEMO_DISABLED_MESSAGE = 'デモでは使えません'

/** DEMO_MODE のときだけ、メソッドとパスが完全に一致する止めるAPIを、処理の前に403で返す。 */
export const demoGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  // 末尾の / を付けたパスでもすり抜けないよう、取り除いてから比べる。
  const path = c.req.path.replace(/\/+$/, '')
  if (isDemoMode(c.env) && DEMO_DISABLED_ROUTES.some((route) => route.method === c.req.method && route.path === path)) {
    return c.json(errorResponse('DEMO_DISABLED', DEMO_DISABLED_MESSAGE), 403)
  }
  await next()
}

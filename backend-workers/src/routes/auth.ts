import { and, eq, isNull, gt } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'
import { z } from 'zod'
import { passwordResetTokens, refreshTokens, users } from '../db/schema'
import { generateOpaqueToken, hashPassword, sha256Hex, verifyPassword } from '../lib/crypto'
import { signAccessToken } from '../lib/jwt'
import type { Bindings } from '../index'

const PASSWORD_RESET_EXPIRATION_SECONDS = 60 * 60 // 1時間
const PASSWORD_RESET_REQUESTED_MESSAGE = 'パスワード再設定用のメールを送信しました(該当するアカウントが存在する場合)'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
})

const logoutSchema = z.object({
  refreshToken: z.string().min(1),
})

const passwordResetRequestSchema = z.object({
  email: z.string().email(),
})

const passwordResetConfirmSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
})

function errorResponse(code: string, message: string) {
  return { code, message }
}

function nowIso(): string {
  return new Date().toISOString()
}

function addSecondsIso(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString()
}

export const authRoute = new Hono<{ Bindings: Bindings }>()

authRoute.post('/register', async (c) => {
  const parsed = registerSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { email, password, displayName } = parsed.data

  const db = drizzle(c.env.DB)
  const existing = await db.select().from(users).where(eq(users.email, email)).get()
  if (existing) {
    return c.json(errorResponse('DUPLICATE_EMAIL', 'このメールアドレスは既に登録されています'), 409)
  }

  const passwordHash = await hashPassword(password)
  await db.insert(users).values({ email, passwordHash, displayName })

  return c.json({}, 201)
})

authRoute.post('/login', async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { email, password } = parsed.data

  const db = drizzle(c.env.DB)
  const user = await db.select().from(users).where(eq(users.email, email)).get()
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return c.json(errorResponse('INVALID_CREDENTIALS', 'メールアドレスまたはパスワードが正しくありません'), 401)
  }

  const accessExpirationSeconds = Number(c.env.JWT_ACCESS_EXPIRATION_SECONDS)
  const refreshExpirationSeconds = Number(c.env.JWT_REFRESH_EXPIRATION_SECONDS)

  const accessToken = await signAccessToken(user.id, c.env.JWT_SECRET, accessExpirationSeconds)
  const refreshToken = generateOpaqueToken()
  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: await sha256Hex(refreshToken),
    expiresAt: addSecondsIso(refreshExpirationSeconds),
  })

  return c.json({ accessToken, refreshToken, expiresIn: accessExpirationSeconds })
})

authRoute.post('/refresh', async (c) => {
  const parsed = refreshSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { refreshToken } = parsed.data

  const db = drizzle(c.env.DB)
  const tokenHash = await sha256Hex(refreshToken)
  const row = await db
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.tokenHash, tokenHash),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, nowIso()),
      ),
    )
    .get()

  if (!row) {
    return c.json(errorResponse('INVALID_TOKEN', 'リフレッシュトークンが無効です'), 401)
  }

  const accessExpirationSeconds = Number(c.env.JWT_ACCESS_EXPIRATION_SECONDS)
  const accessToken = await signAccessToken(row.userId, c.env.JWT_SECRET, accessExpirationSeconds)

  return c.json({ accessToken, expiresIn: accessExpirationSeconds })
})

authRoute.post('/logout', async (c) => {
  const parsed = logoutSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { refreshToken } = parsed.data

  const db = drizzle(c.env.DB)
  const tokenHash = await sha256Hex(refreshToken)
  await db
    .update(refreshTokens)
    .set({ revokedAt: nowIso() })
    .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)))

  return c.json({})
})

authRoute.post('/password-reset/request', async (c) => {
  const parsed = passwordResetRequestSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { email } = parsed.data

  const db = drizzle(c.env.DB)
  const user = await db.select().from(users).where(eq(users.email, email)).get()

  if (user) {
    // メールアドレス列挙攻撃対策のため、成功・失敗に関わらず同じレスポンスを返す。
    // 既存の有効なトークンは無効化してから新しいトークンを発行する。
    await db
      .update(passwordResetTokens)
      .set({ usedAt: nowIso() })
      .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)))

    const token = generateOpaqueToken()
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: await sha256Hex(token),
      expiresAt: addSecondsIso(PASSWORD_RESET_EXPIRATION_SECONDS),
    })
  }

  return c.json({ message: PASSWORD_RESET_REQUESTED_MESSAGE })
})

authRoute.post('/password-reset/confirm', async (c) => {
  const parsed = passwordResetConfirmSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { token, newPassword } = parsed.data

  const db = drizzle(c.env.DB)
  const tokenHash = await sha256Hex(token)
  const row = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, nowIso()),
      ),
    )
    .get()

  if (!row) {
    return c.json(errorResponse('INVALID_TOKEN', 'パスワード再設定用のリンクが無効または期限切れです'), 400)
  }

  // 同時リクエストによる二重消費を防ぐため、まだ未使用の場合のみusedAtを更新する(条件付きUPDATE)。
  const updateResult = await db
    .update(passwordResetTokens)
    .set({ usedAt: nowIso() })
    .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt)))
  if (updateResult.meta.changes === 0) {
    return c.json(errorResponse('INVALID_TOKEN', 'パスワード再設定用のリンクが無効または期限切れです'), 400)
  }

  const newPasswordHash = await hashPassword(newPassword)
  await db.update(users).set({ passwordHash: newPasswordHash }).where(eq(users.id, row.userId))
  // 全端末からログアウトさせるため、そのユーザーの有効なリフレッシュトークンを全て失効させる。
  await db
    .update(refreshTokens)
    .set({ revokedAt: nowIso() })
    .where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt)))

  return c.json({})
})

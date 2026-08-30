import { and, eq, isNull, gt } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { passwordResetTokens, refreshTokens, users } from '../db/schema'
import { generateOpaqueToken, hashPassword, sha256Hex, verifyPassword } from '../lib/crypto'
import { signAccessToken } from '../lib/jwt'
import type { Bindings } from '../index'

const PASSWORD_RESET_EXPIRATION_SECONDS = 60 * 60 // 1時間
const PASSWORD_RESET_REQUESTED_MESSAGE = 'パスワード再設定用のメールを送信しました(該当するアカウントが存在する場合)'
const DUPLICATE_EMAIL_MESSAGE = 'このメールアドレスは既に登録されています'

// 既存Java実装(RegisterRequest)のバリデーション規則をそのまま踏襲する。
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/
const passwordSchema = z.string().regex(PASSWORD_PATTERN, 'パスワードは8文字以上で英字と数字を両方含めてください')
const displayNameSchema = z
  .string()
  .max(50)
  .refine((value) => value.trim().length > 0, { message: '表示名を入力してください' })

const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  displayName: displayNameSchema,
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
  newPassword: passwordSchema,
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

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed')
}

/**
 * リクエストボディをJSONとしてパースする。不正なJSONの場合はnullを返す
 * (c.req.json()は不正なJSONに対して例外を投げるため、それをハンドラ内で捕捉する代わりに利用する)。
 */
async function parseJsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

export const authRoute = new Hono<{ Bindings: Bindings }>()

authRoute.post('/register', async (c) => {
  const body = await parseJsonBody(c)
  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { email, password, displayName } = parsed.data

  const db = drizzle(c.env.DB)
  const existing = await db.select().from(users).where(eq(users.email, email)).get()
  if (existing) {
    return c.json(errorResponse('DUPLICATE_EMAIL', DUPLICATE_EMAIL_MESSAGE), 409)
  }

  const passwordHash = await hashPassword(password)
  try {
    const inserted = await db.insert(users).values({ email, passwordHash, displayName }).returning().get()
    return c.json({ id: inserted.id, email: inserted.email, displayName: inserted.displayName }, 201)
  } catch (error) {
    // 事前チェックとinsertの間で同一メールが同時登録された場合の競合を防ぐ(DBのUNIQUE制約を最終防衛線とする)。
    if (isUniqueConstraintError(error)) {
      return c.json(errorResponse('DUPLICATE_EMAIL', DUPLICATE_EMAIL_MESSAGE), 409)
    }
    throw error
  }
})

authRoute.post('/login', async (c) => {
  const body = await parseJsonBody(c)
  const parsed = loginSchema.safeParse(body)
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
  const body = await parseJsonBody(c)
  const parsed = refreshSchema.safeParse(body)
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
  const body = await parseJsonBody(c)
  const parsed = logoutSchema.safeParse(body)
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

  return c.body(null, 204)
})

authRoute.post('/password-reset/request', async (c) => {
  const body = await parseJsonBody(c)
  const parsed = passwordResetRequestSchema.safeParse(body)
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

    // メール送信基盤(今後の検討事項)が実装されるまでの暫定措置。
    // 生トークンのログ出力はAPP_PASSWORD_RESET_LOG_TOKEN_ENABLED=trueの環境
    // (ローカル開発専用)でのみ行い、共有環境・本番環境では出力しない。
    const logTokenEnabled: string = c.env.APP_PASSWORD_RESET_LOG_TOKEN_ENABLED
    if (logTokenEnabled === 'true') {
      console.warn(`[開発用] パスワードリセットトークンを発行しました。userId=${user.id}, token=${token}`)
    } else {
      console.info(`パスワードリセットトークンを発行しました。userId=${user.id}`)
    }
  }

  return c.json({ message: PASSWORD_RESET_REQUESTED_MESSAGE })
})

authRoute.post('/password-reset/confirm', async (c) => {
  const body = await parseJsonBody(c)
  const parsed = passwordResetConfirmSchema.safeParse(body)
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

  return c.body(null, 200)
})

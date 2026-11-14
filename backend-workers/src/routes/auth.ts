import { and, eq, isNull, gt } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { passwordResetTokens, refreshTokens, users } from '../db/schema'
import { generateOpaqueToken, hashPassword, sha256Hex, verifyPassword } from '../lib/crypto'
import { errorResponse } from '../lib/errors'
import { findDemoMembership, isDemoMode, isExpiredDemoUser } from '../lib/demo'
import { signAccessToken } from '../lib/jwt'
import { issueTokens } from '../lib/tokens'
import { countDeletionBlockers, deletionScheduledAt, hasBlockers, isReservedEmail, isWithinGracePeriod } from '../lib/account-deletion'
import { consumePasswordResetQuota, purgePasswordResetAttempts, resolveMailMode, sendPasswordResetMail } from '../lib/password-reset-mail'
import { RATE_LIMITS, TOO_MANY_REQUESTS_MESSAGE, clientAddressKey, consumeRateLimits, emailKey } from '../lib/rate-limit'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../index'

const PASSWORD_RESET_EXPIRATION_SECONDS = 30 * 60 // 30分(docs/details/features/F01_auth.md参照)
// 送信完了とは断定せず、登録有無・個別の配信失敗も漏らさない文言にする(docs/details/password-reset-mail-design.md)。
const PASSWORD_RESET_REQUESTED_MESSAGE =
  '入力されたメールアドレスが登録済みの場合、再設定の案内メールを送信します。届かない場合は、しばらく待ってからもう一度お試しください'
const PASSWORD_RESET_UNAVAILABLE_MESSAGE = '現在、パスワード再設定メールを利用できません'
const PASSWORD_RESET_RATE_LIMITED_MESSAGE = '申請が多すぎます。しばらく待ってからもう一度お試しください'
const DUPLICATE_EMAIL_MESSAGE = 'このメールアドレスは既に登録されています'

// 既存Java実装(RegisterRequest)のバリデーション規則をそのまま踏襲する。
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/
const passwordSchema = z.string().regex(PASSWORD_PATTERN, 'パスワードは8文字以上で英字と数字を両方含めてください')
const displayNameSchema = z
  .string()
  .max(50)
  .refine((value) => value.trim().length > 0, { message: '表示名を入力してください' })

// 退会済み行に使う予約ドメインのアドレスは、登録・メールアドレス変更で受け付けない(#297)。
const userEmailSchema = z.string().email().refine((value) => !isReservedEmail(value))

const registerSchema = z.object({
  email: userEmailSchema,
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

function nowIso(): string {
  return new Date().toISOString()
}

function addSecondsIso(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString()
}

// メールアドレス列挙攻撃対策用のダミーハッシュ。存在しないメールアドレスでログインを
// 試みられた際にも、実在ユーザーの場合と同程度の計算コスト(PBKDF2の反復)をかけることで、
// レスポンスタイムの差からメールアドレスの存在有無を推測されないようにする。
let dummyPasswordHashPromise: Promise<string> | null = null
function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHashPromise ??= hashPassword('dummy-password-for-timing-safety-only')
  return dummyPasswordHashPromise
}

// drizzleのupdate().returning()はD1のエラーをDrizzleQueryErrorで包むため、causeも辿って判定する。
function isUniqueConstraintError(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (current.message.includes('UNIQUE constraint failed')) return true
  }
  return false
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

// ---- 回数制限(#510) ----
// 上限を超えた要求は、登録の有無や入力内容(パスワードの正誤)と無関係に同じ429を返す。
// パスワードの検証より前に数えるので、上限を超えた後は正しいパスワードでも窓が替わるまで通らない。
function tooManyRequests(c: Context<AppEnv>) {
  return c.json(errorResponse('TOO_MANY_REQUESTS', TOO_MANY_REQUESTS_MESSAGE), 429)
}

// メールアドレスとパスワードで本人確認する入口(ログイン・退会の取り消し)。
function allowCredentialCheck(c: Context<AppEnv>, email: string): Promise<boolean> {
  return consumeRateLimits(c.env.DB, [
    { rule: RATE_LIMITS.loginEmail, key: emailKey(email) },
    { rule: RATE_LIMITS.loginAddress, key: clientAddressKey(c.req.header('CF-Connecting-IP')) },
  ])
}

// ログイン済みの利用者が、現在のパスワードで再認証する操作。
function allowReauth(c: Context<AppEnv>): Promise<boolean> {
  return consumeRateLimits(c.env.DB, [{ rule: RATE_LIMITS.reauthUser, key: String(c.get('userId')) }])
}

export const authRoute = new Hono<AppEnv>()

authRoute.get('/me', requireAuth, async (c) => {
  const user = await drizzle(c.env.DB)
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, c.get('userId')))
    .get()
  if (!user) {
    return c.json(errorResponse('UNAUTHORIZED', '認証が必要です'), 401)
  }
  // デモ環境のデモ利用者だけ、期限と相手の表示名を返す(本番・通常の利用者は null)。
  let demo: { expiresAt: string; partnerName: string } | null = null
  if (isDemoMode(c.env)) {
    const membership = await findDemoMembership(c.env.DB, user.id)
    if (membership) {
      const partnerId = membership.primaryUserId === user.id ? membership.partnerUserId : membership.primaryUserId
      const partner = await drizzle(c.env.DB).select({ displayName: users.displayName }).from(users).where(eq(users.id, partnerId)).get()
      demo = { expiresAt: membership.expiresAt, partnerName: partner?.displayName ?? '' }
    }
  }
  return c.json({ ...user, demo })
})

authRoute.post('/register', async (c) => {
  const body = await parseJsonBody(c)
  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { email, password, displayName } = parsed.data

  const registerAllowed = await consumeRateLimits(c.env.DB, [
    { rule: RATE_LIMITS.registerAddress, key: clientAddressKey(c.req.header('CF-Connecting-IP')) },
  ])
  if (!registerAllowed) return tooManyRequests(c)

  const db = drizzle(c.env.DB)
  const existing = await db.select().from(users).where(eq(users.email, email)).get()
  if (existing) {
    return c.json(errorResponse('DUPLICATE_RESOURCE', DUPLICATE_EMAIL_MESSAGE), 409)
  }

  const passwordHash = await hashPassword(password)
  try {
    const inserted = await db.insert(users).values({ email, passwordHash, displayName }).returning().get()
    return c.json({ id: inserted.id, email: inserted.email, displayName: inserted.displayName }, 201)
  } catch (error) {
    // 事前チェックとinsertの間で同一メールが同時登録された場合の競合を防ぐ(DBのUNIQUE制約を最終防衛線とする)。
    if (isUniqueConstraintError(error)) {
      return c.json(errorResponse('DUPLICATE_RESOURCE', DUPLICATE_EMAIL_MESSAGE), 409)
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
  if (!(await allowCredentialCheck(c, email))) return tooManyRequests(c)

  const db = drizzle(c.env.DB)
  const user = await db.select().from(users).where(eq(users.email, email)).get()
  if (!user) {
    // ユーザーが存在しない場合もダミーハッシュに対して検証を行い、実在ユーザーの場合との
    // 処理時間差からメールアドレスの存在有無を推測されないようにする。
    await verifyPassword(password, await getDummyPasswordHash())
    return c.json(errorResponse('UNAUTHORIZED', 'メールアドレスまたはパスワードが正しくありません'), 401)
  }
  if (!(await verifyPassword(password, user.passwordHash)) || user.deletedAt) {
    return c.json(errorResponse('UNAUTHORIZED', 'メールアドレスまたはパスワードが正しくありません'), 401)
  }
  if (user.deletionRequestedAt) {
    // 退会の取り消し期間中は、取り消すかどうかを画面で確認できるよう削除予定日を返す。期間後はログインできない。
    if (!isWithinGracePeriod(user.deletionRequestedAt)) {
      return c.json(errorResponse('UNAUTHORIZED', 'メールアドレスまたはパスワードが正しくありません'), 401)
    }
    const scheduledAt = deletionScheduledAt(user.deletionRequestedAt)
    return c.json(
      errorResponse('ACCOUNT_DELETION_PENDING', '退会手続き中のアカウントです', [{ field: 'deletionScheduledAt', reason: scheduledAt }]),
      403,
    )
  }

  return c.json(await issueTokens(c.env, user.id))
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
  const owner = await db
    .select({ deletionRequestedAt: users.deletionRequestedAt, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, row.userId))
    .get()
  if (!owner || owner.deletionRequestedAt || owner.deletedAt) {
    return c.json(errorResponse('INVALID_TOKEN', 'リフレッシュトークンが無効です'), 401)
  }

  // デモ環境では、期限切れのデモ利用者のトークンを使わせない(requireAuthを通らないためここでも確かめる)。
  if (isDemoMode(c.env) && (await isExpiredDemoUser(c.env.DB, row.userId, new Date()))) {
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

// 応答を返した後に行う処理(GAS送信・回数制限の清掃)。waitUntilが使えない環境(テスト)ではその場で待つ。
async function runBackground(c: Context<AppEnv>, job: Promise<void>): Promise<void> {
  try {
    c.executionCtx.waitUntil(job)
  } catch {
    await job
  }
}

async function deliverResetMail(env: AppEnv['Bindings'], to: string, token: string): Promise<void> {
  const requestId = crypto.randomUUID()
  try {
    const result = await sendPasswordResetMail(env, { to, token, requestId })
    if (!result.ok) {
      // 宛先・トークン・本文は出さない。失敗の分類と相関IDだけを残す。
      console.warn(`パスワード再設定メールの送信に失敗しました。reason=${result.reason} requestId=${requestId}`)
    }
  } catch {
    console.warn(`パスワード再設定メールの送信で想定外のエラーが発生しました。requestId=${requestId}`)
  }
}

// フロントエンドが再設定メールの利用可否を判定する。認証不要で、設定値は返さない。
authRoute.get('/password-reset/availability', (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json({ available: resolveMailMode(c.env) !== 'unavailable' })
})

authRoute.post('/password-reset/request', async (c) => {
  // 未設定・停止中は、メールアドレスの登録有無や入力内容と無関係に同じ応答を返す。
  const mode = resolveMailMode(c.env)
  if (mode === 'unavailable') {
    return c.json(errorResponse('PASSWORD_RESET_UNAVAILABLE', PASSWORD_RESET_UNAVAILABLE_MESSAGE), 503)
  }

  const body = await parseJsonBody(c)
  const parsed = passwordResetRequestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { email } = parsed.data

  // 回数制限は登録有無と無関係に数える。上限なら新しいトークンも作らず、既存の有効リンクも変えない。
  const allowed = await consumePasswordResetQuota(c.env.DB, { email, ip: c.req.header('CF-Connecting-IP') ?? 'unknown' })
  void runBackground(c, purgePasswordResetAttempts(c.env.DB).then(() => undefined, () => undefined))
  if (!allowed) {
    return c.json(errorResponse('PASSWORD_RESET_RATE_LIMITED', PASSWORD_RESET_RATE_LIMITED_MESSAGE), 429)
  }

  const token = generateOpaqueToken()
  const tokenHash = await sha256Hex(token)
  const expiresAt = addSecondsIso(PASSWORD_RESET_EXPIRATION_SECONDS)
  const now = nowIso()

  // メールアドレスの存在有無に関わらず常に同じSQL(サブクエリでユーザーが存在する場合のみ
  // 実際に行が更新・挿入される)を実行することで、処理時間の差からメールアドレスの
  // 存在有無を推測されないようにする(タイミング攻撃対策)。
  const [, insertResult] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE password_reset_tokens SET used_at = ?
       WHERE user_id = (SELECT id FROM users WHERE email = ?) AND used_at IS NULL`,
    ).bind(now, email),
    c.env.DB.prepare(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       SELECT id, ?, ? FROM users WHERE email = ?`,
    ).bind(tokenHash, expiresAt, email),
  ])

  if (insertResult.meta.changes > 0) {
    if (mode === 'mail') {
      // 送信は応答の後に行い、応答時間から登録有無が分からないようにする。失敗しても応答は変えず、自動再送もしない。
      await runBackground(c, deliverResetMail(c.env, email, token))
    } else {
      // ローカル開発専用(APP_PASSWORD_RESET_LOG_TOKEN_ENABLED=true)。メールは送らず、宛先は出さない。
      console.warn(`[開発用] パスワードリセットトークンを発行しました。token=${token}`)
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
  const now = nowIso()
  const row = await db
    .select()
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, now)))
    .get()

  if (!row) {
    return c.json(errorResponse('INVALID_TOKEN', 'パスワード再設定用のリンクが無効または期限切れです'), 400)
  }

  const newPasswordHash = await hashPassword(newPassword)

  // トークン消費・パスワード更新・リフレッシュトークン失効を1つのD1バッチ(トランザクション)にまとめ、
  // 途中で失敗してもパスワードだけ変わってトークンは未消費のまま、といった中途半端な状態を防ぐ。
  // usersのUPDATEはサブクエリでpassword_reset_tokensがまだ未消費であることを確認してから実行するため、
  // 同時に同じトークンでconfirmされた場合はどちらか一方のみ成功する(バッチ内での二重消費防止)。
  const [usersUpdateResult] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE users SET password_hash = ?
       WHERE id = (
         SELECT user_id FROM password_reset_tokens
         WHERE id = ? AND used_at IS NULL AND expires_at > ?
       )`,
    ).bind(newPasswordHash, row.id, now),
    c.env.DB.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(
      now,
      row.id,
    ),
    // 全端末からログアウトさせるため、そのユーザーの有効なリフレッシュトークンを全て失効させる。
    c.env.DB.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(
      now,
      row.userId,
    ),
  ])

  if (usersUpdateResult.meta.changes === 0) {
    return c.json(errorResponse('INVALID_TOKEN', 'パスワード再設定用のリンクが無効または期限切れです'), 400)
  }

  return c.body(null, 200)
})

// ---- アカウント設定(#291) ----
// パスワード・メールアドレスの変更は現在のパスワードで再認証する(F01_auth.md 8章)。
// メール送信サービス未導入のため、メールアドレス変更は確認メールなしで即時確定する暫定仕様。
const INVALID_CURRENT_PASSWORD_MESSAGE = '現在のパスワードが正しくありません'

// 前後の空白を除いてから長さを検証する(空白込みで50文字を超えても、除いた後が50文字以内なら受け付ける)。
const accountUpdateSchema = z.object({ displayName: z.string().transform((value) => value.trim()).pipe(displayNameSchema) })
const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
  // 今使っている端末のリフレッシュトークン。これだけは失効させずに残す。
  refreshToken: z.string().min(1).optional(),
})
const emailChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newEmail: userEmailSchema,
})

function toAccount(user: { id: number; email: string; displayName: string }) {
  return { id: user.id, email: user.email, displayName: user.displayName }
}

authRoute.get('/account', requireAuth, async (c) => {
  const user = await drizzle(c.env.DB).select().from(users).where(eq(users.id, c.get('userId'))).get()
  if (!user) return c.json(errorResponse('UNAUTHORIZED', '認証が必要です'), 401)
  return c.json(toAccount(user))
})

authRoute.patch('/account', requireAuth, async (c) => {
  const parsed = accountUpdateSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const updated = await drizzle(c.env.DB)
    .update(users)
    .set({ displayName: parsed.data.displayName })
    .where(eq(users.id, c.get('userId')))
    .returning()
    .get()
  if (!updated) return c.json(errorResponse('UNAUTHORIZED', '認証が必要です'), 401)
  return c.json(toAccount(updated))
})

authRoute.put('/password', requireAuth, async (c) => {
  const parsed = passwordChangeSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { currentPassword, newPassword, refreshToken } = parsed.data
  if (!(await allowReauth(c))) return tooManyRequests(c)
  const userId = c.get('userId')
  const user = await drizzle(c.env.DB).select().from(users).where(eq(users.id, userId)).get()
  if (!user) return c.json(errorResponse('UNAUTHORIZED', '認証が必要です'), 401)
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return c.json(errorResponse('VALIDATION_ERROR', INVALID_CURRENT_PASSWORD_MESSAGE, [{ field: 'currentPassword', reason: INVALID_CURRENT_PASSWORD_MESSAGE }]), 400)
  }

  const newPasswordHash = await hashPassword(newPassword)
  const now = nowIso()
  // 検証したハッシュのままの場合だけ更新する(並行してパスワードが変わっていたら上書きしない)。
  // 後続の失効処理も、この更新が反映された場合(=新しいハッシュになっている場合)だけ行う。
  const applied = 'EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)'
  // 今の端末(本人のトークンに限る)以外のリフレッシュトークンを失効させ、他端末をログアウトさせる。
  const keepHash = refreshToken ? await sha256Hex(refreshToken) : ''
  const [updateResult] = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?').bind(newPasswordHash, userId, user.passwordHash),
    // 変更前に発行されたパスワード再設定トークンで上書きされないよう、未使用のものを無効にする。
    c.env.DB.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL AND ${applied}`).bind(now, userId, userId, newPasswordHash),
    c.env.DB.prepare(`UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND token_hash <> ? AND ${applied}`).bind(
      now,
      userId,
      keepHash,
      userId,
      newPasswordHash,
    ),
  ])
  if (updateResult.meta.changes === 0) {
    return c.json(errorResponse('RESOURCE_CONFLICT', 'パスワードが別の操作で変更されました。もう一度お試しください'), 409)
  }
  return c.body(null, 200)
})

authRoute.put('/email', requireAuth, async (c) => {
  const parsed = emailChangeSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { currentPassword, newEmail } = parsed.data
  if (!(await allowReauth(c))) return tooManyRequests(c)
  const db = drizzle(c.env.DB)
  const userId = c.get('userId')
  const user = await db.select().from(users).where(eq(users.id, userId)).get()
  if (!user) return c.json(errorResponse('UNAUTHORIZED', '認証が必要です'), 401)
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return c.json(errorResponse('VALIDATION_ERROR', INVALID_CURRENT_PASSWORD_MESSAGE, [{ field: 'currentPassword', reason: INVALID_CURRENT_PASSWORD_MESSAGE }]), 400)
  }
  if (newEmail === user.email) return c.json(toAccount(user))
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, newEmail)).get()
  if (existing) return c.json(errorResponse('DUPLICATE_RESOURCE', DUPLICATE_EMAIL_MESSAGE), 409)

  try {
    // 再認証したハッシュのままの場合だけ変更する。旧アドレス宛てに発行済みの再設定トークンも同時に無効にする。
    const [updateResult] = await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET email = ? WHERE id = ? AND password_hash = ?').bind(newEmail, userId, user.passwordHash),
      c.env.DB.prepare(
        'UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = ? AND email = ?)',
      ).bind(nowIso(), userId, userId, newEmail),
    ])
    if (updateResult.meta.changes === 0) {
      return c.json(errorResponse('RESOURCE_CONFLICT', 'パスワードが別の操作で変更されました。もう一度お試しください'), 409)
    }
    return c.json(toAccount({ ...user, email: newEmail }))
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.json(errorResponse('DUPLICATE_RESOURCE', DUPLICATE_EMAIL_MESSAGE), 409)
    }
    throw error
  }
})

// ---- 退会(#297、F01_auth.md 8-2章) ----
const deletionRequestSchema = z.object({ currentPassword: z.string().min(1) })
const INVALID_LOGIN_MESSAGE = 'メールアドレスまたはパスワードが正しくありません'

authRoute.get('/account/deletion-check', requireAuth, async (c) => {
  const blockers = await countDeletionBlockers(c.env.DB, c.get('userId'))
  return c.json({ canRequest: !hasBlockers(blockers), ...blockers })
})

authRoute.post('/account/deletion', requireAuth, async (c) => {
  const parsed = deletionRequestSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  if (!(await allowReauth(c))) return tooManyRequests(c)
  const userId = c.get('userId')
  const user = await drizzle(c.env.DB).select().from(users).where(eq(users.id, userId)).get()
  if (!user) return c.json(errorResponse('UNAUTHORIZED', '認証が必要です'), 401)
  if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    return c.json(
      errorResponse('VALIDATION_ERROR', INVALID_CURRENT_PASSWORD_MESSAGE, [{ field: 'currentPassword', reason: INVALID_CURRENT_PASSWORD_MESSAGE }]),
      400,
    )
  }
  const blockers = await countDeletionBlockers(c.env.DB, userId)
  if (hasBlockers(blockers)) {
    return c.json(
      errorResponse('RESOURCE_CONFLICT', '未精算の割り勘や、他の人が負担する固定費が残っているため退会できません', [
        { field: 'unsettledSplits', reason: String(blockers.unsettledSplits) },
        { field: 'fixedCostsWithOthers', reason: String(blockers.fixedCostsWithOthers) },
      ]),
      409,
    )
  }

  const now = nowIso()
  // 申し込みと同時に、全端末のリフレッシュトークンと未使用の再設定トークンを失効させる。
  const [updateResult] = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET deletion_requested_at = ? WHERE id = ? AND password_hash = ? AND deletion_requested_at IS NULL')
      .bind(now, userId, user.passwordHash),
    c.env.DB.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, userId),
    c.env.DB.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').bind(now, userId),
  ])
  if (updateResult.meta.changes === 0) {
    return c.json(errorResponse('RESOURCE_CONFLICT', 'パスワードが別の操作で変更されました。もう一度お試しください'), 409)
  }
  return c.json({ deletionScheduledAt: deletionScheduledAt(now) })
})

// 取り消しはログインできない状態で行うため、メールアドレスとパスワードで本人確認する。成功したらログイン状態にする。
authRoute.post('/account/deletion/cancel', async (c) => {
  const parsed = loginSchema.safeParse(await parseJsonBody(c))
  if (!parsed.success) {
    return c.json(errorResponse('VALIDATION_ERROR', '入力内容を確認してください'), 400)
  }
  const { email, password } = parsed.data
  if (!(await allowCredentialCheck(c, email))) return tooManyRequests(c)
  const user = await drizzle(c.env.DB).select().from(users).where(eq(users.email, email)).get()
  if (!user) {
    await verifyPassword(password, await getDummyPasswordHash())
    return c.json(errorResponse('UNAUTHORIZED', INVALID_LOGIN_MESSAGE), 401)
  }
  if (!(await verifyPassword(password, user.passwordHash)) || user.deletedAt) {
    return c.json(errorResponse('UNAUTHORIZED', INVALID_LOGIN_MESSAGE), 401)
  }
  if (!user.deletionRequestedAt) {
    return c.json(errorResponse('VALIDATION_ERROR', '退会手続き中のアカウントではありません'), 400)
  }
  if (!isWithinGracePeriod(user.deletionRequestedAt)) {
    return c.json(errorResponse('UNAUTHORIZED', INVALID_LOGIN_MESSAGE), 401)
  }
  // 期限の直前に日次処理と競合しても削除済みの行は復活させず、並行してパスワードが変わっていたら取り消さない。
  const result = await c.env.DB.prepare(
    'UPDATE users SET deletion_requested_at = NULL WHERE id = ? AND deleted_at IS NULL AND deletion_requested_at = ? AND password_hash = ?',
  )
    .bind(user.id, user.deletionRequestedAt, user.passwordHash)
    .run()
  if (result.meta.changes === 0) {
    return c.json(errorResponse('UNAUTHORIZED', INVALID_LOGIN_MESSAGE), 401)
  }
  return c.json(await issueTokens(c.env, user.id))
})

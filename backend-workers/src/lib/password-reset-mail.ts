// パスワード再設定メールの送信(GAS MailApp中継)と申請回数制限(#401)。
// 設計: docs/details/password-reset-mail-design.md
// 共通鍵・トークン・メールアドレスなどの実値はログへ出さない。

export interface PasswordResetMailEnv {
  /** 非秘密の停止スイッチ。'true'のときだけメール送信を有効にする。 */
  PASSWORD_RESET_MAIL_ENABLED?: string
  /** GASのWebアプリURL(secret)。 */
  PASSWORD_RESET_GAS_URL?: string
  /** GASと共有するHMAC鍵(secret)。 */
  PASSWORD_RESET_GAS_SECRET?: string
  /** ローカル開発専用。メールを送らず、生トークンをログに出す。 */
  APP_PASSWORD_RESET_LOG_TOKEN_ENABLED?: string
}

export type MailMode = 'mail' | 'dev-log' | 'unavailable'

/** 申請の回数制限。固定窓で数える(窓の境目では最大2倍の瞬間的な申請が通りうる)。 */
export const RATE_LIMITS = {
  email: { limit: 3, windowSeconds: 60 * 60 },
  ip: { limit: 10, windowSeconds: 60 * 60 },
  // Googleの個人アカウントの1日100宛先より低く保つ。
  global: { limit: 50, windowSeconds: 24 * 60 * 60 },
} as const

/** 回数制限の行を残す期間。最長の窓(1日)より長く、2日とする。 */
export const RATE_LIMIT_RETENTION_SECONDS = 2 * 24 * 60 * 60

const GAS_TIMEOUT_MS = 8_000
const SIGNATURE_VERSION = 'v1'

function isGasUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'script.google.com'
  } catch {
    return false
  }
}

/**
 * 送信方法を決める。mail=GAS経由で送信、dev-log=ローカル専用でトークンをログへ出す、unavailable=利用不可。
 * 未設定・停止中はメールアドレスと無関係に同じ結果になる。
 */
export function resolveMailMode(env: PasswordResetMailEnv): MailMode {
  if (env.PASSWORD_RESET_MAIL_ENABLED === 'true' && env.PASSWORD_RESET_GAS_SECRET && env.PASSWORD_RESET_GAS_URL && isGasUrl(env.PASSWORD_RESET_GAS_URL)) {
    return 'mail'
  }
  if (env.APP_PASSWORD_RESET_LOG_TOKEN_ENABLED === 'true') return 'dev-log'
  return 'unavailable'
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function digestKey(scope: string, value: string): Promise<string> {
  const data = new TextEncoder().encode(`password-reset-rate-limit:${scope}:${value}`)
  return toHex(await crypto.subtle.digest('SHA-256', data))
}

export interface SignedFields {
  timestamp: number
  requestId: string
  to: string
  token: string
}

/** `v1.<時刻>.<要求ID>.<宛先>.<トークン>` に対するHMAC-SHA256(16進)。共通鍵自体は送らない。 */
export async function signMailRequest(secret: string, fields: SignedFields): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const payload = `${SIGNATURE_VERSION}.${fields.timestamp}.${fields.requestId}.${fields.to}.${fields.token}`
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
}

export type MailFailureReason = 'timeout' | 'network' | 'http_error' | 'invalid_response' | 'quota' | 'signature' | 'expired' | 'authorization' | 'config' | 'busy' | 'rejected'
export type MailResult = { ok: true } | { ok: false; reason: MailFailureReason }

const GAS_REJECT_CODES: Record<string, MailFailureReason> = {
  quota: 'quota',
  signature: 'signature',
  expired: 'expired',
  authorization: 'authorization',
  config: 'config',
  busy: 'busy',
}

/**
 * 署名付きの要求をGASへ1回だけ送る。自動再送はしない(タイムアウト時は届いている可能性がある)。
 * 戻り値とログには失敗の分類だけを含め、宛先・トークン・本文は含めない。
 */
export async function sendPasswordResetMail(
  env: PasswordResetMailEnv,
  input: { to: string; token: string; requestId: string },
  nowMs: number = Date.now(),
): Promise<MailResult> {
  const timestamp = Math.floor(nowMs / 1000)
  const signature = await signMailRequest(env.PASSWORD_RESET_GAS_SECRET ?? '', { timestamp, ...input })
  let response: Response
  try {
    response = await fetch(env.PASSWORD_RESET_GAS_URL ?? '', {
      method: 'POST',
      // GASのWebアプリはContent-Typeに関係なく本文を受け取る。プリフライトを避けるためtext/plainにする。
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ version: SIGNATURE_VERSION, timestamp, requestId: input.requestId, to: input.to, token: input.token, signature }),
      signal: AbortSignal.timeout(GAS_TIMEOUT_MS),
    })
  } catch (error) {
    return { ok: false, reason: error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'network' }
  }
  if (!response.ok) return { ok: false, reason: 'http_error' }
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    return { ok: false, reason: 'invalid_response' }
  }
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { ok?: unknown }).ok !== 'boolean') {
    return { ok: false, reason: 'invalid_response' }
  }
  const body = parsed as { ok: boolean; code?: unknown }
  if (body.ok) return { ok: true }
  return { ok: false, reason: (typeof body.code === 'string' && GAS_REJECT_CODES[body.code]) || 'rejected' }
}

const CONSUME_SQL = `INSERT INTO password_reset_attempts (scope, key_hash, window_start, count) VALUES (?, ?, ?, 1)
  ON CONFLICT(scope, key_hash, window_start) DO UPDATE SET count = count + 1 WHERE count < ?`

function windowStart(nowMs: number, windowSeconds: number): number {
  return Math.floor(nowMs / 1000 / windowSeconds) * windowSeconds
}

/**
 * メール・接続元・アプリ全体の3つの窓を1回のD1バッチで数える。各カウントは1文の条件付きUPSERTで
 * 原子的に増えるため、複数Workersが同時に申請しても上限を超えて許可されない。
 * どれか1つでも上限なら false(その申請では他のカウントも消費する。保守的な側に倒れる)。
 * 登録有無は判定に使わないので、応答から存在は分からない。
 */
export async function consumePasswordResetQuota(
  db: D1Database,
  who: { email: string; ip: string },
  nowMs: number = Date.now(),
): Promise<boolean> {
  const targets = [
    { scope: 'email', key: who.email.trim().toLowerCase(), ...RATE_LIMITS.email },
    { scope: 'ip', key: who.ip, ...RATE_LIMITS.ip },
    { scope: 'global', key: 'all', ...RATE_LIMITS.global },
  ]
  const statements = await Promise.all(
    targets.map(async (target) =>
      db.prepare(CONSUME_SQL).bind(target.scope, await digestKey(target.scope, target.key), windowStart(nowMs, target.windowSeconds), target.limit),
    ),
  )
  const results = await db.batch(statements)
  return results.every((result) => result.meta.changes > 0)
}

/** 保持期間を過ぎた回数制限の行を削除し、削除件数を返す。 */
export async function purgePasswordResetAttempts(db: D1Database, nowMs: number = Date.now()): Promise<number> {
  const threshold = Math.floor(nowMs / 1000) - RATE_LIMIT_RETENTION_SECONDS
  const result = await db.prepare('DELETE FROM password_reset_attempts WHERE window_start < ?').bind(threshold).run()
  return result.meta.changes
}
